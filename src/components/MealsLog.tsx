"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import {
  checkSeqAndRemember,
  rememberSavedSeq,
  SeqAlarm,
} from "@/components/SeqAlarm";
import { MEALS_CONTEXT } from "@/lib/aevcontext";
import { randomId } from "@/lib/crypto";
import {
  addEntry,
  addFood,
  ageLabel,
  bucketFoods,
  dayHeading,
  dayTotals,
  EMPTY_MEALS_CONFIG,
  entriesFor,
  fitsMealsCap,
  foodName,
  foodUsage,
  matchFoods,
  matchIndex,
  MEALS_MAX_BYTES,
  mealsPayloadBytes,
  nextDay,
  normalizeMealsConfig,
  parseMacroInput,
  parseQtyInput,
  prevDay,
  removeEntry,
  removeFood,
  setTargets,
  trailingProtein,
  updateFood,
  type MealsConfig,
  type MealsFood,
  type MealsTargets,
} from "@/lib/meals";
import { nextSeq } from "@/lib/seqrule";
import { commas } from "@/lib/steps";

const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

type Tab = "today" | "foods";

const TABS: Tab[] = ["today", "foods"];

/** How many rows the picker shows at once — enough that the week's rotation is
 *  all there, without the list burying the day's log under it. */
const PICKER_ROWS = 8;

type MacroKey = keyof MealsTargets;

/** Protein leads every reading on the page — it is the macro that gates the
 *  training, and the only one worth an accent. */
const MACRO_ROWS: { key: MacroKey; label: string; unit: string }[] = [
  { key: "p", label: "protein", unit: "g" },
  { key: "kcal", label: "kcal", unit: "" },
  { key: "c", label: "carbs", unit: "g" },
  { key: "f", label: "fat", unit: "g" },
];

const MACRO_KEYS: MacroKey[] = ["kcal", "p", "c", "f"];

/** The four fields as the owner is typing them — strings, not numbers. */
type MacroText = Record<MacroKey, string>;

const EMPTY_MACRO_TEXT: MacroText = { kcal: "", p: "", c: "", f: "" };

/** Every field a plain number, or null while any one of them is unusable. */
function parseMacros(text: MacroText): MealsTargets | null {
  const out: MealsTargets = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const k of MACRO_KEYS) {
    const n = parseMacroInput(text[k]);
    if (n === null) return null;
    out[k] = n;
  }
  return out;
}

function macroText(macros: MealsTargets): MacroText {
  return {
    kcal: String(macros.kcal),
    p: String(macros.p),
    c: String(macros.c),
    f: String(macros.f),
  };
}

/** Today in Sydney as YYYY-MM-DD — the day an entry is stamped with. The device
 *  clock is the owner's clock (the todo `created` precedent), and pinning the zone
 *  keeps an entry's date on the same calendar the strips are drawn on. */
function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

/**
 * MealsLog — the meal log, as ONE client island. The food library, the entries
 * and the targets all live in the `meta/meals` envelope, so there is one fetch,
 * one decrypt and one normalize behind both views; the server stores ciphertext
 * it never parses. Sealed dots until the vault key is in hand (the IDB cache
 * usually means it already is), and the decrypted log leaves the moment the vault
 * locks.
 *
 * Every save is the fin panel's seal → PUT → retry-once-on-409 dance over a PURE
 * transform, re-applied against freshly-fetched state on the conflict — so
 * logging lunch on the phone while the PC has the page open can't lose either.
 * Nothing is optimistic: an entry is on the page after it is sealed, not before.
 * There is no draft mirror here (unlike /gym): logging is one tap on a food that
 * already exists, so there is never a half-finished thing to lose with the tab.
 */
export function MealsLog({ offline }: { offline: boolean }) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<MealsConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [seqAlarm, setSeqAlarm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("today");

  // Render-phase reset on the lock/unlock edge (the glance idiom): the decrypted
  // log leaves with the key.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setCfg(null);
    setDataErr(null);
    setNotice(null);
  }

  // Load + decrypt once per unlock. A healthy 404 is first-run; anything else
  // must never look like it (the keystore lesson).
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      let config: MealsConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/meals");
        if (res.status === 404) {
          config = EMPTY_MEALS_CONFIG;
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope, MEALS_CONTEXT);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeMealsConfig(parsed);
            if (!config) throw new Error("bad shape");
            existed = true;
          } catch {
            if (!cancelled) setDataErr("tamper");
            return;
          }
        } else {
          if (!cancelled) setDataErr("unreachable");
          return;
        }
      } catch {
        if (!cancelled) setDataErr("unreachable");
        return;
      }
      if (cancelled) return;
      setCfg(config);
      setConfigExisted(existed);
      // Rollback check (58b) — a 404 for a log this device has seen alarms too.
      void checkSeqAndRemember("meals", config).then((rolled) => {
        if (rolled && !cancelled) setSeqAlarm(true);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  async function putConfig(
    next: MealsConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    // Bump the sealed write counter (58b); prior = the newer of loaded state
    // and next itself (a 409-dance rebuild carries the fresher seq).
    next = { ...next, seq: Math.max(nextSeq(cfg ?? {}), nextSeq(next)) };
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "meals.json", t: "application/json", s: bytes.length },
      bytes,
      MEALS_CONTEXT,
    );
    const res = await fetch("/api/meals", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-meals-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    if (res.ok) rememberSavedSeq("meals", next);
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<MealsConfig> {
    const res = await fetch("/api/meals");
    if (res.status === 404) return EMPTY_MEALS_CONFIG;
    if (res.status !== 200) throw new Error("meals refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope, MEALS_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeMealsConfig(parsed);
    if (!config) throw new Error("meals refetch: bad shape");
    return config;
  }

  /** Apply a pure transform, seal, PUT — retrying once against a fresh config on
   *  a 409 (the other device may have logged something meanwhile). */
  async function saveConfig(
    apply: (base: MealsConfig) => MealsConfig,
  ): Promise<boolean> {
    if (!cfg) return false;
    setBusy(true);
    setNotice(null);
    try {
      let base = cfg;
      // The cap is client-side law — refuse with a reason rather than let the
      // route answer an opaque 404 on an oversized frame.
      if (!fitsMealsCap(apply(base))) {
        setNotice("log is full — the envelope cap is reached");
        return false;
      }
      let result = await putConfig(apply(base), configExisted);
      if (result === "conflict") {
        base = await fetchConfigFresh();
        result = await putConfig(apply(base), true);
      }
      if (result !== "ok") {
        setNotice("could not save — try again");
        return false;
      }
      setCfg(apply(base));
      setConfigExisted(true);
      return true;
    } catch {
      setNotice("could not save — try again");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // --- render ---

  if (!unlocked || !cfg) {
    return (
      <div className="px-4 py-4">
        <p className="text-xs text-muted">
          {dataErr === "unreachable" ? (
            <span className="text-down">
              vault unreachable — reload to retry
            </span>
          ) : dataErr === "tamper" ? (
            <span className="text-down">cannot decrypt — lock and unlock</span>
          ) : unlocked ? (
            "decrypting…"
          ) : (
            <>
              {TABS.join(" · ")} <span className="text-muted/40">·····</span>{" "}
              sealed —{" "}
              <Link href="/files" className="text-amber hover:underline">
                unlock in files →
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {seqAlarm && (
        <div className="px-4 pt-4">
          <SeqAlarm what="meals log" />
        </div>
      )}

      <nav className="flex gap-4 border-b border-hairline px-4 py-2 text-xs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              t === tab
                ? "text-amber"
                : "text-muted transition-colors hover:text-amber"
            }
          >
            {t}
          </button>
        ))}
      </nav>

      {notice && (
        <p className="border-b border-hairline px-4 py-2 text-xs text-down">
          {notice}
        </p>
      )}

      {tab === "today" && (
        <TodayView cfg={cfg} busy={busy} saveConfig={saveConfig} />
      )}
      {tab === "foods" && (
        <FoodsView cfg={cfg} busy={busy} saveConfig={saveConfig} />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------------
// today — the day's bars, the fortnight of protein, and the log
// -------------------------------------------------------------------------------

function TodayView({
  cfg,
  busy,
  saveConfig,
}: {
  cfg: MealsConfig;
  busy: boolean;
  saveConfig: (apply: (base: MealsConfig) => MealsConfig) => Promise<boolean>;
}) {
  const today = sydneyToday();
  // Which day the view reads — null means "follow today", so an overnight tab
  // rolls forward with the clock; a concrete date means the owner stepped away.
  const [viewed, setViewed] = useState<string | null>(null);
  const day = viewed !== null && viewed < today ? viewed : today;
  const onToday = day === today;

  const totals = dayTotals(cfg, day);
  const targets = cfg.targets ?? null;
  const entries = entriesFor(cfg, day);
  const [foodId, setFoodId] = useState("");
  const [qtyText, setQtyText] = useState("1");
  const qty = parseQtyInput(qtyText);
  // Picking a food hands focus straight to the quantity — the only field left to
  // touch before the add.
  const qtyRef = useRef<HTMLInputElement>(null);

  async function add() {
    if (!foodId || qty === null) return;
    const ok = await saveConfig((base) =>
      // Stamped with the VIEWED day, not today — stepping back and adding is
      // how a forgotten dinner gets logged onto the day it happened.
      addEntry(base, { id: randomId(), date: day, foodId, qty }),
    );
    if (ok) setQtyText("1");
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-2 border-b border-hairline px-4 py-2 text-xs">
        <button
          type="button"
          aria-label="previous day"
          onClick={() => setViewed(prevDay(day))}
          className="px-1.5 text-muted/60 transition-colors hover:text-amber"
        >
          ‹
        </button>
        <span className={onToday ? "text-amber" : "text-fg/90"}>
          {dayHeading(day)}
        </span>
        <button
          type="button"
          aria-label="next day"
          disabled={onToday}
          onClick={() => {
            const n = nextDay(day);
            setViewed(n === today ? null : n);
          }}
          className="px-1.5 text-muted/60 transition-colors hover:text-amber disabled:opacity-30"
        >
          ›
        </button>
        {!onToday && (
          <button
            type="button"
            onClick={() => setViewed(null)}
            className="ml-auto text-muted transition-colors hover:text-amber"
          >
            today →
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-b border-hairline px-4 py-3">
        {MACRO_ROWS.map((m) => (
          <MacroBar
            key={m.key}
            label={m.label}
            unit={m.unit}
            accent={m.key === "p"}
            value={totals[m.key]}
            target={targets?.[m.key] ?? null}
          />
        ))}
        {!targets && (
          <p className="text-[11px] text-muted">set targets in foods →</p>
        )}

        <div className="mt-2">
          <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted">
            protein · 14d
          </p>
          <ProteinStrip
            values={trailingProtein(cfg, day)}
            target={targets?.p ?? null}
          />
        </div>
      </div>

      {cfg.foods.length === 0 ? (
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3 text-xs">
          <p className="text-muted">add foods in the foods tab →</p>
        </div>
      ) : (
        <FoodPicker
          cfg={cfg}
          today={today}
          busy={busy}
          foodId={foodId}
          onPick={setFoodId}
          onPicked={() => qtyRef.current?.focus()}
        >
          <span className="text-muted">×</span>
          {/* A text field, not type="number": a controlled number input snaps a
              cleared field back to 0, so typing lands beside the prefill. The
              string is the state here; `parseQtyInput` decides if it's usable. */}
          <input
            ref={qtyRef}
            type="text"
            inputMode="decimal"
            value={qtyText}
            disabled={busy}
            onChange={(e) => setQtyText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            className={`w-14 shrink-0 text-right tabular-nums ${input}`}
            aria-label="quantity"
          />
          <button
            type="button"
            className={btn}
            disabled={busy || !foodId || qty === null}
            onClick={() => void add()}
          >
            {busy ? "…" : "add"}
          </button>
        </FoodPicker>
      )}

      {entries.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted">
          {onToday
            ? "nothing logged today"
            : `nothing logged on ${dayHeading(day)}`}
        </p>
      ) : (
        entries.map((e) => {
          const food = cfg.foods.find((f) => f.id === e.foodId);
          return (
            <div
              key={e.id}
              className="flex items-baseline gap-3 border-b border-hairline px-4 py-2 text-[13px]"
            >
              <span className="min-w-0 flex-1 text-fg/90">
                {foodName(cfg, e.foodId)}{" "}
                <span className="text-muted">×{e.qty}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted">
                {food
                  ? `${commas(Math.round(food.kcal * e.qty))} · p${Math.round(
                      food.p * e.qty,
                    )}`
                  : "—"}
              </span>
              <button
                type="button"
                aria-label="remove entry"
                disabled={busy}
                className="shrink-0 text-muted/50 transition-colors hover:text-down disabled:opacity-30"
                onClick={() => void saveConfig((b) => removeEntry(b, e.id))}
              >
                ×
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * The composer's food field — a filter over the library rather than a `<select>`.
 * The library only ever grows (nothing is deleted from it), so a native picker
 * becomes a scroll through years of one-offs; here the last eight eaten are one
 * tap away and everything older is three letters away.
 *
 * The list renders INLINE under the composer, pushing the day's log down, rather
 * than floating over it: a positioned dropdown on a phone is a scroll trap. Rows
 * swallow the mousedown so the field keeps focus — the pick lands on the click
 * that follows, and a real blur can still close the list. The trailing controls
 * ride in as children, which is what keeps the row and the list siblings.
 */
function FoodPicker({
  cfg,
  today,
  busy,
  foodId,
  onPick,
  onPicked,
  children,
}: {
  cfg: MealsConfig;
  today: string;
  busy: boolean;
  foodId: string;
  onPick: (id: string) => void;
  onPicked: () => void;
  children: ReactNode;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const pickedName = cfg.foods.find((f) => f.id === foodId)?.name ?? "";
  // A field still showing the picked name is not a query — re-opening it offers
  // the recent list again (the name is select-all'd, so typing replaces it).
  const query = text === pickedName ? "" : text.trim();
  const { foods, more } = matchFoods(cfg, query, PICKER_ROWS);

  function pick(food: MealsFood) {
    onPick(food.id);
    setText(food.name);
    setOpen(false);
    onPicked();
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-3 text-xs">
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          value={text}
          disabled={busy}
          onFocus={(e) => {
            setOpen(true);
            // With a food already picked the name select-alls, so typing
            // replaces it instead of landing in the middle of it.
            if (foodId) e.currentTarget.select();
          }}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            // Edited away from the picked name, the pick is stale — drop it
            // rather than let the add log a food the field no longer shows.
            if (e.target.value !== pickedName) onPick("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key !== "Enter") return;
            // A standing pick is kept — Enter just moves on to the quantity;
            // otherwise it takes the top match.
            if (foodId) {
              setOpen(false);
              onPicked();
            } else if (foods[0]) pick(foods[0]);
          }}
          placeholder="food…"
          className={`min-w-0 flex-1 ${input}`}
          aria-label="food"
        />
        {children}
      </div>
      {open && (
        <div className="border-b border-hairline pb-1.5 pt-1">
          {!query && (
            <p className="px-4 text-[10px] uppercase tracking-[0.12em] text-muted/60">
              recent
            </p>
          )}
          {foods.length === 0 ? (
            <p className="px-4 py-1 text-[13px] text-muted">
              no match — add it in the foods tab
            </p>
          ) : (
            foods.map((f) => (
              <button
                key={f.id}
                type="button"
                // Swallowing the mousedown keeps the field focused, so the blur
                // that closes the list can't fire ahead of the click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(f)}
                className="group flex w-full items-baseline gap-2.5 px-4 py-1 text-left text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate text-fg/90 transition-colors group-hover:text-amber">
                  <Highlight name={f.name} query={query} />
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted">
                  {commas(f.kcal)} · p{f.p}
                </span>
                <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted/60">
                  {ageLabel(foodUsage(cfg, f).lastUsed, today)}
                </span>
              </button>
            ))
          )}
          {more > 0 && (
            <p className="px-4 py-1 text-[11px] text-muted/60">
              + {more} more · {query ? "keep typing" : "type to filter"}
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** The typed run in amber — the reason this row is on screen at all. */
function Highlight({ name, query }: { name: string; query: string }) {
  const at = matchIndex(name, query);
  if (at < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <span className="text-amber">{name.slice(at, at + query.length)}</span>
      {name.slice(at + query.length)}
    </>
  );
}

/** One macro against its target. With no target there is nothing to fill toward,
 *  so the track stays empty and the number carries the whole reading; past the
 *  target the bar stops at full and the number goes amber instead of overflowing. */
function MacroBar({
  label,
  value,
  target,
  unit,
  accent,
}: {
  label: string;
  value: number;
  target: number | null;
  unit: string;
  accent: boolean;
}) {
  const filled = target !== null && target > 0 ? (value / target) * 100 : 0;
  const over = target !== null && value > target;
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <span className="h-1.5 min-w-0 flex-1 bg-surface">
        <span
          className={`block h-full ${accent ? "bg-amber" : "bg-fg/30"}`}
          style={{ width: `${Math.min(100, filled)}%` }}
        />
      </span>
      <span
        className={`w-28 shrink-0 text-right text-xs tabular-nums ${
          over ? "text-amber" : "text-muted"
        }`}
      >
        {commas(Math.round(value))}
        {target !== null && ` / ${commas(Math.round(target))}`}
        {unit && ` ${unit}`}
      </span>
    </div>
  );
}

/** The fortnight of protein. With a target set a day either cleared it or it
 *  didn't (the only reading that matters); with none, the days scale against the
 *  best of them so the shape still shows. */
function ProteinStrip({
  values,
  target,
}: {
  values: number[];
  target: number | null;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex gap-0.5" role="img" aria-label="protein, last 14 days">
      {values.map((v, i) => (
        <span key={i} className={`h-3.5 flex-1 ${cellClass(v, target, max)}`} />
      ))}
    </div>
  );
}

function cellClass(value: number, target: number | null, max: number): string {
  if (value <= 0) return "bg-surface";
  if (target !== null && target > 0)
    return value >= target ? "bg-amber/70" : "bg-fg/25";
  if (value >= max * 0.66) return "bg-fg/50";
  return value >= max * 0.33 ? "bg-fg/30" : "bg-fg/15";
}

// -------------------------------------------------------------------------------
// foods — the library, and the targets everything reads against
// -------------------------------------------------------------------------------

function FoodsView({
  cfg,
  busy,
  saveConfig,
}: {
  cfg: MealsConfig;
  busy: boolean;
  saveConfig: (apply: (base: MealsConfig) => MealsConfig) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const used = mealsPayloadBytes(cfg);
  // The library is grouped by how recently each food was eaten, so the rotation
  // sits at the top and the one-offs sink — the ages read against TODAY, not
  // against whichever day the other tab is browsing.
  const today = sydneyToday();

  /** A food that has been eaten can't leave — removing it would rewrite the
   *  totals of every day that contained it (see `removeFood`). */
  const inUse = (id: string) => cfg.entries.some((e) => e.foodId === id);

  return (
    <div className="flex flex-col">
      <div className="border-b border-hairline px-4 py-3">
        <FoodForm
          busy={busy}
          label="add"
          onSubmit={(name, macros) =>
            saveConfig((b) => addFood(b, { id: randomId(), name, ...macros }))
          }
        />
      </div>

      {cfg.foods.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted">
          no foods yet — one line each, and every meal after is a quantity
        </p>
      ) : (
        bucketFoods(cfg, today)
          .filter((bucket) => bucket.foods.length > 0)
          .map((bucket) => (
            <div key={bucket.key} className="flex flex-col">
              <p className="flex justify-between border-b border-hairline px-4 pt-2 pb-0.5 text-[10px] uppercase tracking-[0.12em] text-muted/60">
                <span>{bucket.label}</span>
                <span className="tabular-nums">{bucket.foods.length}</span>
              </p>
              {bucket.foods.map((f) => {
                const usage = foodUsage(cfg, f);
                return (
                  <div
                    key={f.id}
                    className="border-b border-hairline px-4 py-2.5"
                  >
                    {editing === f.id ? (
                      <FoodForm
                        food={f}
                        busy={busy}
                        label="save"
                        onCancel={() => setEditing(null)}
                        onSubmit={async (name, macros) => {
                          const ok = await saveConfig((b) =>
                            updateFood(b, f.id, { name, ...macros }),
                          );
                          if (ok) setEditing(null);
                          return ok;
                        }}
                      />
                    ) : (
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-sm text-fg/90">{f.name}</span>
                        <span className="text-xs tabular-nums text-muted">
                          {commas(f.kcal)} · p{f.p} c{f.c} f{f.f} /unit
                        </span>
                        {/* The chip carries the right edge (its auto margin), so
                            a never-logged food renders it EMPTY rather than
                            dropping it and un-anchoring the buttons. */}
                        <span className="ml-auto text-[11px] tabular-nums text-muted/60">
                          {usage.uses > 0 && `${usage.uses}×`}
                          {usage.lastUsed !== null &&
                            ` · ${ageLabel(usage.lastUsed, today)}`}
                        </span>
                        <button
                          type="button"
                          className="text-[11px] text-muted/60 transition-colors hover:text-amber"
                          onClick={() => setEditing(f.id)}
                        >
                          edit
                        </button>
                        <button
                          type="button"
                          disabled={busy || inUse(f.id)}
                          title={
                            inUse(f.id)
                              ? "eaten — rename it instead"
                              : undefined
                          }
                          className="text-[11px] text-muted/60 transition-colors hover:text-down disabled:opacity-30"
                          onClick={() =>
                            void saveConfig((b) => removeFood(b, f.id))
                          }
                        >
                          {inUse(f.id) ? "in use" : "delete"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
      )}

      <div className="border-b border-hairline px-4 py-3">
        <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
          targets
        </p>
        <TargetsForm
          targets={cfg.targets ?? null}
          busy={busy}
          onSubmit={(t) => saveConfig((b) => setTargets(b, t))}
        />
      </div>

      {/* The honest cap readout — the log is one fixed envelope, so its ceiling
          is a real number and worth showing rather than discovering. */}
      <p className="px-4 py-2.5 text-[11px] tabular-nums text-muted/60">
        envelope · {commas(used)} / {commas(MEALS_MAX_BYTES)} bytes ·{" "}
        {cfg.entries.length} entries · {cfg.foods.length} foods
      </p>
    </div>
  );
}

/** The four macro fields, as text. They hold their own strings and only become
 *  numbers on submit, so a cleared field stays cleared under the cursor. */
function MacroFields({
  text,
  busy,
  onChange,
}: {
  text: MacroText;
  busy: boolean;
  onChange: (next: MacroText) => void;
}) {
  return (
    <>
      {MACRO_KEYS.map((k) => (
        <input
          key={k}
          type="text"
          inputMode="decimal"
          value={text[k]}
          disabled={busy}
          onChange={(e) => onChange({ ...text, [k]: e.target.value })}
          placeholder={k}
          className={`w-16 shrink-0 text-right tabular-nums ${input}`}
          aria-label={`${k} per unit`}
        />
      ))}
    </>
  );
}

/** Add or edit one library food — the macros for ONE unit of it, whatever the
 *  name says that unit is. `onSubmit` reports whether the save landed, so the
 *  add form only clears itself once the envelope has it. */
function FoodForm({
  food,
  busy,
  label,
  onSubmit,
  onCancel,
}: {
  food?: MealsFood;
  busy: boolean;
  label: string;
  onSubmit: (name: string, macros: MealsTargets) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(food?.name ?? "");
  const [text, setText] = useState<MacroText>(
    food ? macroText(food) : EMPTY_MACRO_TEXT,
  );
  const macros = parseMacros(text);

  async function submit() {
    if (!name.trim() || macros === null) return;
    const ok = await onSubmit(name, macros);
    if (ok && !food) {
      setName("");
      setText(EMPTY_MACRO_TEXT);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <input
        type="text"
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
        placeholder="food (unit)"
        className={`min-w-32 flex-1 ${input}`}
        aria-label="food name"
      />
      <MacroFields text={text} busy={busy} onChange={setText} />
      <button
        type="button"
        className={btn}
        disabled={busy || !name.trim() || macros === null}
        onClick={() => void submit()}
      >
        {busy ? "…" : label}
      </button>
      {onCancel && (
        <button
          type="button"
          className="text-muted transition-colors hover:text-amber"
          onClick={onCancel}
        >
          cancel
        </button>
      )}
    </div>
  );
}

/** The daily targets. Absent until set — there is no default intake to invent,
 *  and until then the day's bars are totals with nothing to read against. */
function TargetsForm({
  targets,
  busy,
  onSubmit,
}: {
  targets: MealsTargets | null;
  busy: boolean;
  onSubmit: (targets: MealsTargets) => Promise<boolean>;
}) {
  const [text, setText] = useState<MacroText>(
    targets ? macroText(targets) : EMPTY_MACRO_TEXT,
  );
  const parsed = parseMacros(text);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <MacroFields text={text} busy={busy} onChange={setText} />
      <button
        type="button"
        className={btn}
        disabled={busy || parsed === null}
        onClick={() => parsed && void onSubmit(parsed)}
      >
        {busy ? "…" : "save"}
      </button>
    </div>
  );
}
