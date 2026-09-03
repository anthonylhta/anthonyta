import type {
  ApertureCondition,
  ApertureDoc,
  ApertureGlance,
  ApertureStreak,
  ApertureTrial,
} from "./aperture";

/**
 * aperturesync — the pure spine of the owner-run `aperture-sync` script
 * (`scripts/aperture-sync.ts`), which is a thin IO shell over these three
 * functions. Same division vault-sync keeps with lib/searchidx and lib/merkle:
 * anything worth testing lives here, and the script does nothing but read a file,
 * unwrap a key, and move bytes.
 *
 * Nothing here adjudicates. `lib/aperture` says the site renders and never decides;
 * this module is the writer half of the same bargain — it projects, diffs, and
 * diagnoses the document it is handed, and never edits it. A count is wrong only if
 * it was wrong in `aperture.json`, which is curated upstream of the script.
 *
 * Pure and env-less: no store, no `node:*`, no clock (the diff compares two
 * documents, never a document against "now"), so vitest reaches all of it.
 */

// --- the glance projection ----------------------------------------------------

/**
 * The plaintext glance for a validated document: rank, stage, and the seal instant,
 * and DELIBERATELY nothing else — this is the one part of the status that lands
 * unsealed, so every field added here is a field the server learns for good
 * (aperturestore's note on the two shapes of opacity).
 *
 * `sealedAt` is copied from the document rather than stamped with the script's own
 * clock, so the band's freshness reading and the island's document can never
 * disagree — and the staleness dot measures the last CHECK-IN, not the last time
 * the script happened to run. `normalizeApertureGlance` is the mirror of this
 * function and pins the shape from the read side.
 */
export function apertureGlance(doc: ApertureDoc): ApertureGlance {
  return {
    v: 1,
    sealedAt: doc.sealedAt,
    rank: doc.public.rank,
    stage: doc.public.stage,
  };
}

// --- the archive day ----------------------------------------------------------

// en-CA formats as YYYY-MM-DD. Hoisted — Intl formatters are costly to build.
const SYDNEY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Sydney",
});

/**
 * The Sydney calendar day a seal belongs to — the `day` its archived copy is
 * keyed by (`aevcontext.apertureHistPath`). Sydney rather than UTC for the same
 * reason lib/activity buckets Sydney: the check-in happens on the owner's
 * calendar, and a Sunday-morning seal must not archive under Saturday's date.
 *
 * Takes the instant, not a clock (this module owns none), and expects it
 * already validated — `normalizeAperture` guarantees `sealedAt` parses, and an
 * unparseable instant here would throw rather than mint a junk key.
 */
export function sealDay(sealedAt: string): string {
  return SYDNEY_DAY.format(new Date(sealedAt));
}

// --- the diff summary ---------------------------------------------------------

/** `1 streak` / `2 streaks` — the counts in the first-seal line. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** `rank 3 · upper`, the reading both the snapshot and the change line share. */
function rankReading(rank: number, stage: string): string {
  return `rank ${rank} · ${stage}`;
}

/**
 * A first seal has nothing to diff against, so it prints what it just sealed
 * instead: the shape of the whole document, so the run's output still confirms the
 * blob is what the owner expected rather than the empty summary a "no changes" line
 * would give.
 */
function snapshotLine(doc: ApertureDoc): string {
  const { streaks, conditions, paths, trials, breakthrough } = doc.sealed;
  return [
    "first seal",
    rankReading(doc.public.rank, doc.public.stage),
    plural(Object.keys(streaks).length, "streak"),
    plural(conditions.length, "condition"),
    plural(paths.length, "path"),
    plural(trials.length, "trial"),
    `wall ${breakthrough.wall}`,
  ].join(" · ");
}

/**
 * Streak count changes, one segment each. The keys are data (an open record), so a
 * name appearing or vanishing is itself news and gets a segment — a streak that
 * quietly dropped out of the check-in must not read as "nothing changed".
 *
 * `Object.hasOwn` rather than a bare lookup: a streak named `toString` would
 * otherwise find Object.prototype's method and diff against its `undefined` count.
 */
function streakChanges(
  before: Record<string, ApertureStreak>,
  after: Record<string, ApertureStreak>,
): string[] {
  const out: string[] = [];
  for (const [name, s] of Object.entries(after)) {
    if (!Object.hasOwn(before, name)) {
      out.push(`${name} new (${s.count})`);
      continue;
    }
    const prev = before[name];
    if (prev.count !== s.count) out.push(`${name} ${prev.count}→${s.count}`);
  }
  for (const name of Object.keys(before))
    if (!Object.hasOwn(after, name)) out.push(`${name} gone`);
  return out;
}

/**
 * Condition status changes, joined by LABEL — the human-readable field, because
 * that is what the summary line has to read back to the owner. Two conditions
 * sharing a label collapse into one comparison; that is a summary's rounding error,
 * not a correctness bug (the sealed document keeps both rows either way).
 */
function conditionChanges(
  before: ApertureCondition[],
  after: ApertureCondition[],
): string[] {
  const prev = new Map(before.map((c) => [c.label, c.status]));
  const changed: string[] = [];
  const added: string[] = [];
  for (const c of after) {
    const was = prev.get(c.label);
    if (was === undefined) added.push(c.label);
    else if (was !== c.status) changed.push(`${c.label} ${was}→${c.status}`);
  }
  const kept = new Set(after.map((c) => c.label));
  const gone = before.filter((c) => !kept.has(c.label)).map((c) => c.label);

  const out: string[] = [];
  if (changed.length > 0)
    out.push(`conditions: ${changed.length} changed (${changed.join(", ")})`);
  if (added.length > 0)
    out.push(`conditions: +${added.length} (${added.join(", ")})`);
  if (gone.length > 0)
    out.push(`conditions: -${gone.length} (${gone.join(", ")})`);
  return out;
}

/**
 * Trial state changes by NAME, plus arrivals counted by the state they arrive in
 * (`+1 stocked`) — a banked trial is the common check-in edit, and its name is
 * usually the least interesting thing about it. Departures stay named, since a
 * trial leaving the document is rarer and worth being able to question.
 */
function trialChanges(
  before: ApertureTrial[],
  after: ApertureTrial[],
): string[] {
  const prev = new Map(before.map((t) => [t.name, t.state]));
  const changed: string[] = [];
  const addedByState = new Map<string, number>();
  for (const t of after) {
    const was = prev.get(t.name);
    if (was === undefined)
      addedByState.set(t.state, (addedByState.get(t.state) ?? 0) + 1);
    else if (was !== t.state) changed.push(`${t.name} ${was}→${t.state}`);
  }
  const kept = new Set(after.map((t) => t.name));
  const gone = before.filter((t) => !kept.has(t.name)).map((t) => t.name);

  const out: string[] = [];
  if (changed.length > 0) out.push(`trials: ${changed.join(", ")}`);
  if (addedByState.size > 0)
    out.push(
      `trials: ${[...addedByState].map(([state, n]) => `+${n} ${state}`).join(", ")}`,
    );
  if (gone.length > 0) out.push(`trials: -${gone.length} (${gone.join(", ")})`);
  return out;
}

/**
 * The change segments between two documents — everything `diffSummary` prints
 * after its rank lead. Exported for the record band (lib/aperturerecord), whose
 * rows each carry their own rank reading and would only duplicate the lead.
 * Scope stays diffSummary's: streak counts, condition statuses, trial states.
 */
export function diffChanges(
  oldDoc: ApertureDoc,
  newDoc: ApertureDoc,
): string[] {
  return [
    ...streakChanges(oldDoc.sealed.streaks, newDoc.sealed.streaks),
    ...conditionChanges(oldDoc.sealed.conditions, newDoc.sealed.conditions),
    ...trialChanges(oldDoc.sealed.trials, newDoc.sealed.trials),
  ];
}

/**
 * What this run changed, as one line for the script to print. The rank reading
 * leads ALWAYS — even unchanged — because it is the figure the owner is checking
 * the run against; everything after it is only what moved.
 *
 * Scope is deliberately modest: rank/stage, streak counts, condition statuses, and
 * trial states. Progress figures, notes, paths and the breakthrough block are
 * sealed and re-read seconds later in the panel, so echoing them here would be a
 * second rendering of the module to keep in step for no gain.
 */
export function diffSummary(
  oldDoc: ApertureDoc | null,
  newDoc: ApertureDoc,
): string {
  if (oldDoc === null) return snapshotLine(newDoc);

  const o = oldDoc.public;
  const n = newDoc.public;
  const rankMoved = o.rank !== n.rank || o.stage !== n.stage;
  const lead = rankMoved
    ? `${rankReading(o.rank, o.stage)} → ${n.rank} · ${n.stage}`
    : `rank unchanged (${n.rank} · ${n.stage})`;

  const changes = diffChanges(oldDoc, newDoc);
  if (!rankMoved && changes.length === 0)
    return `${lead} · nothing else changed`;
  return [lead, ...changes].join(" · ");
}

// --- rejection diagnosis ------------------------------------------------------

/**
 * BEST-EFFORT, NEVER AUTHORITATIVE. `normalizeAperture` is the gate; this walk only
 * exists to answer "which field?" after that gate has already said no, so the owner
 * can fix a check-in without diffing it against a type by eye. It duplicates
 * lib/aperture's predicates rather than importing them (they are private there, and
 * a diagnostic has no business widening a module's surface) — which means it can
 * drift, so it reports the FIRST thing it can pin and falls back to an honest
 * "couldn't pin it" line instead of guessing.
 *
 * It never blames a vocabulary value. The frame is strict but the vocabulary is
 * open (lib/aperture's bargain): a stage, status, tier or rung this build has never
 * heard of is VALID and renders muted, so a rejection is always about a type, a
 * shape or a missing field — never about a word.
 */
const UNPINNED =
  "the document does not match the aperture frame, and no single field could be " +
  "pinned — compare it against ApertureDoc in src/lib/aperture.ts";

/** A named failure, or null when the value is fine. */
type Fail = string | null;

/** The first pinned failure among cheap already-evaluated checks. */
function first(...fails: Fail[]): Fail {
  for (const f of fails) if (f !== null) return f;
  return null;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** How a value reads inside a diagnosis: small literals verbatim, the rest by type. */
function show(x: unknown): string {
  if (x === undefined) return "nothing";
  if (x === null) return "null";
  if (Array.isArray(x)) return "an array";
  if (typeof x === "string")
    return x.length <= 40
      ? JSON.stringify(x)
      : `a ${x.length}-character string`;
  if (typeof x === "object") return "an object";
  return String(x);
}

function needStr(v: unknown, at: string): Fail {
  return typeof v === "string"
    ? null
    : `${at} must be a string (found ${show(v)})`;
}

function needNonEmptyStr(v: unknown, at: string): Fail {
  if (typeof v !== "string")
    return `${at} must be a non-empty string (found ${show(v)})`;
  return v.length > 0 ? null : `${at} must not be empty`;
}

function needFiniteNum(v: unknown, at: string): Fail {
  return typeof v === "number" && Number.isFinite(v)
    ? null
    : `${at} must be a finite number (found ${show(v)})`;
}

/** A calendar day — the birth day's own shape, named so a bad emission reads as
 *  "not a day" rather than the vaguer "not a string". */
function needDay(v: unknown, at: string): Fail {
  if (typeof v !== "string")
    return `${at} must be a YYYY-MM-DD day (found ${show(v)})`;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v))
    ? null
    : `${at} must be a YYYY-MM-DD day (found ${show(v)})`;
}

/** A whole number of at least 1 — a feeding period, and nothing else so far. */
function needPosInt(v: unknown, at: string): Fail {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0
    ? null
    : `${at} must be a whole number of at least 1 (found ${show(v)})`;
}

function needBool(v: unknown, at: string): Fail {
  return typeof v === "boolean"
    ? null
    : `${at} must be true or false (found ${show(v)})`;
}

/** An absent optional field is fine; a PRESENT one is held to its type. */
function ifPresent(
  v: unknown,
  at: string,
  check: (v: unknown, at: string) => Fail,
): Fail {
  return v === undefined ? null : check(v, at);
}

/** Walk every row of an array field, naming the first bad row by its index. */
function eachRow(
  v: unknown,
  at: string,
  walk: (row: unknown, at: string) => Fail,
): Fail {
  if (!Array.isArray(v)) return `${at} must be an array (found ${show(v)})`;
  for (let i = 0; i < v.length; i++) {
    const f = walk(v[i], `${at}[${i}]`);
    if (f !== null) return f;
  }
  return null;
}

function walkStreak(x: unknown, at: string): Fail {
  if (!isObj(x)) return `${at} must be an object (found ${show(x)})`;
  return first(
    needFiniteNum(x.count, `${at}.count`),
    needFiniteNum(x.target, `${at}.target`),
    needNonEmptyStr(x.state, `${at}.state`),
    ifPresent(x.earliestHarden, `${at}.earliestHarden`, needStr),
    ifPresent(x.pausesThisQuarter, `${at}.pausesThisQuarter`, needFiniteNum),
  );
}

function walkCondition(x: unknown, at: string): Fail {
  if (!isObj(x)) return `${at} must be an object (found ${show(x)})`;
  return first(
    needStr(x.id, `${at}.id`),
    needStr(x.label, `${at}.label`),
    needNonEmptyStr(x.status, `${at}.status`),
    needFiniteNum(x.progress, `${at}.progress`),
    needFiniteNum(x.target, `${at}.target`),
    needStr(x.unit, `${at}.unit`),
  );
}

function walkGu(x: unknown, at: string): Fail {
  if (!isObj(x)) return `${at} must be an object (found ${show(x)})`;
  return first(
    needStr(x.name, `${at}.name`),
    ifPresent(x.type, `${at}.type`, needStr),
    ifPresent(x.bears, `${at}.bears`, needBool),
    // The feeding clock's two hands are typed here but NOT paired: normalize
    // drops a lone one rather than rejecting, so pairing is not a rejection this
    // walk could ever be explaining.
    ifPresent(x.fed, `${at}.fed`, needDay),
    ifPresent(x.interval, `${at}.interval`, needPosInt),
    ifPresent(x.repo, `${at}.repo`, needNonEmptyStr),
  );
}

function walkPath(x: unknown, at: string): Fail {
  if (!isObj(x)) return `${at} must be an object (found ${show(x)})`;
  return first(
    needStr(x.name, `${at}.name`),
    ifPresent(x.role, `${at}.role`, needStr),
    ifPresent(x.attainment, `${at}.attainment`, needStr),
    ifPresent(x.verified, `${at}.verified`, needBool),
    ifPresent(x.note, `${at}.note`, needStr),
    ifPresent(x.activity, `${at}.activity`, needStr),
    ifPresent(x.peak, `${at}.peak`, needNonEmptyStr),
    ifPresent(x.next, `${at}.next`, needStr),
    x.gu === undefined ? null : eachRow(x.gu, `${at}.gu`, walkGu),
    x.sub === undefined ? null : eachRow(x.sub, `${at}.sub`, walkPath),
  );
}

/**
 * The prose ceilings, MIRRORED from lib/aperture rather than imported — the same
 * bargain the predicates above keep, where a diagnostic never widens the module
 * it diagnoses. Drift here costs a pinned line, not a wrong verdict: the gate is
 * still `normalizeAperture`, and a ceiling this walk has stale simply falls
 * through to the honest "couldn't pin it".
 */
const MAX_ENLIGHTENMENTS = 50;
const MAX_PARAGRAPHS = 60;
const MAX_PARAGRAPH_CHARS = 4000;
const MAX_TITLE_CHARS = 200;
const MAX_RULINGS = 30;
const MAX_RULING_CHARS = 4000;

/** Printable prose with a ceiling — a title, a paragraph, a ruling. */
function needProse(max: number): (v: unknown, at: string) => Fail {
  return (v, at) =>
    first(
      needNonEmptyStr(v, at),
      typeof v === "string" && v.length > max
        ? `${at} must be at most ${max} characters (found ${v.length})`
        : null,
    );
}

/** An array field with a ceiling. The ROWS are walked first: a malformed row is a
 *  more useful thing to be told about than a list one entry too long. */
function cappedRows(
  v: unknown,
  at: string,
  max: number,
  walk: (row: unknown, at: string) => Fail,
): Fail {
  const rows = eachRow(v, at, walk);
  if (rows !== null) return rows;
  return Array.isArray(v) && v.length > max
    ? `${at} must hold at most ${max} entries (found ${v.length})`
    : null;
}

function walkEnlightenment(x: unknown, at: string): Fail {
  if (!isObj(x)) return `${at} must be an object (found ${show(x)})`;
  const body = x.body;
  return first(
    needDay(x.date, `${at}.date`),
    needProse(MAX_TITLE_CHARS)(x.title, `${at}.title`),
    ifPresent(x.trial, `${at}.trial`, needStr),
    Array.isArray(body) && body.length === 0
      ? `${at}.body must hold at least one paragraph`
      : cappedRows(
          body,
          `${at}.body`,
          MAX_PARAGRAPHS,
          needProse(MAX_PARAGRAPH_CHARS),
        ),
  );
}

function walkRuling(x: unknown, at: string): Fail {
  if (!isObj(x)) return `${at} must be an object (found ${show(x)})`;
  return first(
    needDay(x.date, `${at}.date`),
    needProse(MAX_RULING_CHARS)(x.text, `${at}.text`),
  );
}

function walkTrial(x: unknown, at: string): Fail {
  if (!isObj(x)) return `${at} must be an object (found ${show(x)})`;
  return first(
    needStr(x.name, `${at}.name`),
    needNonEmptyStr(x.tier, `${at}.tier`),
    needNonEmptyStr(x.state, `${at}.state`),
    ifPresent(x.opened, `${at}.opened`, needStr),
    // `date: null` is meaningful — a resolved-or-banked trial with no day yet.
    x.date === undefined || x.date === null
      ? null
      : needStr(x.date, `${at}.date`),
    ifPresent(x.provisioned, `${at}.provisioned`, needBool),
  );
}

function walkBreakthrough(x: unknown, at: string): Fail {
  if (!isObj(x)) return `${at} must be an object (found ${show(x)})`;
  const strikes = x.recentStrikes;
  return first(
    needStr(x.wall, `${at}.wall`),
    needStr(x.event, `${at}.event`),
    eachRow(x.routes, `${at}.routes`, needStr),
    !isObj(strikes) || Array.isArray(strikes)
      ? `${at}.recentStrikes must be an object keyed by strike name (found ${show(strikes)})`
      : first(
          ...Object.entries(strikes).map(([k, v]) =>
            needFiniteNum(v, `${at}.recentStrikes.${k}`),
          ),
        ),
  );
}

function walkSealed(x: unknown): Fail {
  if (!isObj(x)) return `sealed must be an object (found ${show(x)})`;
  const streaks = x.streaks;
  return first(
    !isObj(streaks) || Array.isArray(streaks)
      ? `sealed.streaks must be an object keyed by streak name (found ${show(streaks)})`
      : first(
          ...Object.entries(streaks).map(([k, v]) =>
            walkStreak(v, `sealed.streaks.${k}`),
          ),
        ),
    eachRow(x.conditions, "sealed.conditions", walkCondition),
    eachRow(x.paths, "sealed.paths", walkPath),
    ifPresent(x.vitalGu, "sealed.vitalGu", (v, at) =>
      !isObj(v)
        ? `${at} must be an object (found ${show(v)})`
        : first(
            needStr(v.name, `${at}.name`),
            needFiniteNum(v.rank, `${at}.rank`),
            needFiniteNum(v.max, `${at}.max`),
            v.candidates === undefined
              ? null
              : eachRow(v.candidates, `${at}.candidates`, needStr),
          ),
    ),
    eachRow(x.trials, "sealed.trials", walkTrial),
    walkBreakthrough(x.breakthrough, "sealed.breakthrough"),
    ifPresent(x.next, "sealed.next", needNonEmptyStr),
    x.enlightenments === undefined
      ? null
      : cappedRows(
          x.enlightenments,
          "sealed.enlightenments",
          MAX_ENLIGHTENMENTS,
          walkEnlightenment,
        ),
    x.rulings === undefined
      ? null
      : cappedRows(x.rulings, "sealed.rulings", MAX_RULINGS, walkRuling),
    x.rented === undefined ? null : eachRow(x.rented, "sealed.rented", needStr),
    ifPresent(x.profile, "sealed.profile", (v, at) =>
      !isObj(v)
        ? `${at} must be an object (found ${show(v)})`
        : ifPresent(v.born, `${at}.born`, needDay),
    ),
  );
}

function walkDoc(x: unknown): Fail {
  if (!isObj(x) || Array.isArray(x))
    return `the document must be a JSON object (found ${show(x)})`;
  if (x.v !== 1) return `v must be exactly 1 (found ${show(x.v)})`;
  if (
    typeof x.sealedAt !== "string" ||
    !Number.isFinite(Date.parse(x.sealedAt))
  )
    return `sealedAt must be a date string an engine can parse (found ${show(x.sealedAt)})`;
  if (!isObj(x.public))
    return `public must be an object (found ${show(x.public)})`;
  const pub = x.public;
  const rank = pub.rank;
  if (typeof rank !== "number" || !Number.isSafeInteger(rank) || rank <= 0)
    return `public.rank must be a whole number of at least 1 (found ${show(rank)})`;
  return first(
    needNonEmptyStr(pub.stage, "public.stage"),
    walkSealed(x.sealed),
  );
}

/**
 * Why `normalizeAperture` rejected this document, naming the offending field where
 * the walk can pin one. Pure and total — it never throws and always returns a line
 * fit to print, so the script can fail with a diagnosis in every case.
 */
export function explainApertureRejection(doc: unknown): string {
  return walkDoc(doc) ?? UNPINNED;
}
