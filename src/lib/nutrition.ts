/**
 * nutrition — reads the numbers off a pasted Australian nutrition information
 * panel, so a new library food on /meals is a paste and a tap instead of four
 * numbers typed off a label. Pure text in, figures out; no lookup, no database,
 * no model — the label stays the source of truth (0122's standing rule), this
 * only saves the transcription.
 *
 * Two shapes of paste are handled, both seen in real use:
 *   - the supermarket product page (Coles/Woolworths): each nutrient on its own
 *     line, followed by `12.6gPer serving12.6g` and `9.0gPer 100 grams…9.0g`
 *     lines — values repeated either side of a "per serving"/"per 100" marker;
 *   - the panel itself, transcribed or OCR'd row-wise: `Protein 18.6 g 37% 5.8 g`
 *     — per-serve, an optional %DI, then per-100.
 * The trick that unifies them: collect the unit-bearing numbers after each label,
 * drop the percentages, collapse consecutive repeats, and what is left is
 * [per serve, per 100] in that order (the AU panel's own column order).
 *
 * Energy is kilojoules on every AU label; kilocalories are taken from a
 * `(425 Cal)` figure when the label prints one, else converted (kJ / 4.184).
 */

export interface LabelFigures {
  kcal: number | null;
  /** grams */
  p: number | null;
  c: number | null;
  f: number | null;
}

export interface NutritionLabel {
  /** As printed — `140 g`, `320 g`, `approx. 46 g` — or null when absent. */
  servingSize: string | null;
  servingsPerPack: number | null;
  perServe: LabelFigures | null;
  per100: LabelFigures | null;
}

type Key =
  | "energy"
  | "protein"
  | "fat"
  | "saturated"
  | "carbs"
  | "sugars"
  | "fibre"
  | "sodium"
  | "servingSize"
  | "servings";

/** Label spellings, matched on the lowercased text. Order matters only for the
 *  overlap rule below: `saturated fat` must claim its `fat`. */
const LABELS: [Key, RegExp][] = [
  ["saturated", /\bsaturated(\s+fat)?\b|\bsat\.?\s*fat\b/g],
  ["fat", /\b(total\s+)?fat\b(,?\s*total)?/g],
  ["energy", /\benergy\b|\bcalories\b/g],
  ["protein", /\bprotein\b/g],
  ["carbs", /\b(total\s+)?carbohydrates?\b|\bcarbs\b/g],
  ["sugars", /\bsugars?\b/g],
  ["fibre", /\bdietary\s+fibre\b|\bfibre\b|\bfiber\b/g],
  ["sodium", /\bsodium\b/g],
  ["servingSize", /\bserving\s+size\b/g],
  ["servings", /\bservings?\s+per\b/g],
];

const KJ_PER_KCAL = 4.184;

interface Token {
  value: number;
  unit: "kj" | "kcal" | "g" | "mg";
}

/** Every unit-bearing number in a segment, in order — percentages excluded, and
 *  the "per 100 g / per 100 mL" marker's own 100 struck out first so it can't
 *  read as a gram figure. */
function tokens(segment: string): Token[] {
  const cleaned = segment.replace(
    /per\s*100\s*(g|grams?|ml|millilitres?|milliliters?)\b/g,
    " ",
  );
  const out: Token[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(kj|kcal|cal|g|mg)\b(?!\s*%)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const value = Number(m[1].replace(",", "."));
    if (!Number.isFinite(value)) continue;
    const u = m[2];
    out.push({
      value,
      unit: u === "cal" ? "kcal" : (u as Token["unit"]),
    });
  }
  return out;
}

/** [per serve, per 100] from a run of same-unit values: consecutive repeats
 *  collapse (the product page prints each figure twice), then position decides.
 *  One value alone is the per-serve figure — a panel lists that column first. */
function pair(values: number[]): [number | null, number | null] {
  const seq: number[] = [];
  for (const v of values) if (seq[seq.length - 1] !== v) seq.push(v);
  return [seq[0] ?? null, seq[1] ?? null];
}

/** Locate every label in the text; a `fat` sitting inside a `saturated fat`
 *  match belongs to saturated, not to total fat. */
function findLabels(text: string): { key: Key; start: number; end: number }[] {
  const found: { key: Key; start: number; end: number }[] = [];
  for (const [key, re] of LABELS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const inside = found.some(
        (f) => f.key === "saturated" && start >= f.start && start < f.end,
      );
      if (key === "fat" && inside) continue;
      found.push({ key, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * Parse a pasted panel. Null when the text carries none of the four figures at
 * all — a paste that isn't a label. Missing fields inside a recognised label
 * are null, never guessed, so the form can leave that box for the owner to type.
 */
export function parseNutritionLabel(input: string): NutritionLabel | null {
  const text = input.toLowerCase().replace(/[–—]/g, "-");
  const labels = findLabels(text);
  if (labels.length === 0) return null;

  // Each label's segment runs to the next label; the FIRST occurrence of a key
  // wins (a panel prints each once — a repeat is a header or footnote).
  const segments = new Map<Key, string>();
  labels.forEach((l, i) => {
    if (segments.has(l.key)) return;
    const next = labels[i + 1];
    segments.set(l.key, text.slice(l.end, next ? next.start : undefined));
  });

  const grams = (key: Key): [number | null, number | null] => {
    const seg = segments.get(key);
    if (seg === undefined) return [null, null];
    return pair(
      tokens(seg)
        .filter((t) => t.unit === "g")
        .map((t) => t.value),
    );
  };

  const energySeg = segments.get("energy");
  let kcal: [number | null, number | null] = [null, null];
  if (energySeg !== undefined) {
    const ts = tokens(energySeg);
    const cal = pair(ts.filter((t) => t.unit === "kcal").map((t) => t.value));
    const kj = pair(ts.filter((t) => t.unit === "kj").map((t) => t.value));
    kcal = [
      cal[0] ?? (kj[0] === null ? null : Math.round(kj[0] / KJ_PER_KCAL)),
      cal[1] ?? (kj[1] === null ? null : Math.round(kj[1] / KJ_PER_KCAL)),
    ];
  }

  const p = grams("protein");
  const c = grams("carbs");
  const f = grams("fat");

  const column = (i: 0 | 1): LabelFigures | null => {
    const fig = { kcal: kcal[i], p: p[i], c: c[i], f: f[i] };
    return Object.values(fig).every((v) => v === null) ? null : fig;
  };
  const perServe = column(0);
  const per100 = column(1);
  if (perServe === null && per100 === null) return null;

  return {
    servingSize: servingSize(segments.get("servingSize")),
    servingsPerPack: servingsPerPack(segments.get("servings")),
    perServe,
    per100,
  };
}

/** The printed serving size, trimmed to its measure: `140 g`, `approx. 46 g`. */
function servingSize(seg: string | undefined): string | null {
  if (seg === undefined) return null;
  const m =
    /((?:approx\.?\s*)?\d+(?:[.,]\d+)?\s*(?:g|ml|grams?|millilitres?))\b/.exec(
      seg,
    );
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

function servingsPerPack(seg: string | undefined): number | null {
  if (seg === undefined) return null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(seg);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Figures rounded the way the library stores them (kcal whole, grams to one
 *  decimal — 0135's rule) and readied for the form: a null stays empty text so
 *  the owner types that box, nothing is invented. */
export function labelFieldText(fig: LabelFigures): {
  kcal: string;
  p: string;
  c: string;
  f: string;
} {
  const one = (v: number | null) =>
    v === null ? "" : String(Math.round(v * 10) / 10);
  return {
    kcal: fig.kcal === null ? "" : String(Math.round(fig.kcal)),
    p: one(fig.p),
    c: one(fig.c),
    f: one(fig.f),
  };
}
