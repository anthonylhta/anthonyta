"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import {
  checkSeqAndRemember,
  rememberSavedSeq,
  SeqAlarm,
} from "@/components/SeqAlarm";
import { Sparkline } from "@/components/terminal/Sparkline";
import { GYM_CONTEXT } from "@/lib/aevcontext";
import { randomId } from "@/lib/crypto";
import {
  addExercise,
  addSession,
  bestE1rm,
  bestFor,
  draftHasSets,
  draftToSession,
  e1rmSeries,
  EMPTY_GYM_CONFIG,
  EMPTY_GYM_DRAFT,
  exerciseName,
  findExerciseByName,
  fitsGymCap,
  formatRest,
  GYM_DRAFT_KEY,
  GYM_MAX_BYTES,
  gymPayloadBytes,
  isPr,
  lastDoneFor,
  lastSetsFor,
  normalizeGymConfig,
  parseDraft,
  parseSetInput,
  plateauWeeks,
  prefillSet,
  removeSession,
  removeTemplate,
  renameExercise,
  restSeconds,
  sessionVolume,
  templateName,
  upsertTemplate,
  weeklyVolume,
  type GymConfig,
  type GymDraft,
  type GymSet,
  type GymTemplate,
} from "@/lib/gym";
import { nextSeq } from "@/lib/seqrule";
import { commas } from "@/lib/steps";

const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";
/** The ± steppers — small, square, thumb-reachable. */
const step =
  "border border-hairline px-1.5 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

/** Weight moves in plate increments; reps move one at a time. */
const WEIGHT_STEP = 2.5;

type Tab = "log" | "history" | "exercises" | "templates";

const TABS: Tab[] = ["log", "history", "exercises", "templates"];

/** Today in Sydney as YYYY-MM-DD — the day a session is stamped with. The device
 *  clock is the owner's clock (the todo `created` precedent), and pinning the zone
 *  keeps a session's date on the same calendar the server's strips are drawn on. */
function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

/** The moment a set changed, for the rest clock. It sits beside `sydneyToday`
 *  because this is where the file reads clocks — `setEntrySets` only ever runs
 *  off a tap, so this is an event-time reading, never a render-time one. */
function restStamp(): number {
  return Date.now();
}

/** `60×8 · 60×8` — how a set list reads everywhere on the page. */
function setsLine(sets: GymSet[]): string {
  return sets.map((s) => `${s.w}×${s.r}`).join(" · ");
}

/** The draft this device was left with, if any — a workout the owner walked away
 *  from mid-set, whether the tab was backgrounded, killed, or closed outright.
 *  A draft written by an older build is dropped, not restored into a crash
 *  (`parseDraft`); a browser with no storage at all simply has no draft. */
function readDraft(): GymDraft {
  if (typeof window === "undefined") return EMPTY_GYM_DRAFT;
  try {
    const stored = localStorage.getItem(GYM_DRAFT_KEY);
    if (!stored) return EMPTY_GYM_DRAFT;
    const parsed = parseDraft(stored);
    if (parsed) return parsed;
    localStorage.removeItem(GYM_DRAFT_KEY);
  } catch {
    // no localStorage (private mode, disabled) — the draft just isn't durable
  }
  return EMPTY_GYM_DRAFT;
}

/**
 * GymLog — the training log, as ONE client island. Sessions, the exercise catalog
 * and the templates all live in the `meta/gym` envelope, so there is one fetch,
 * one decrypt and one normalize behind every view; the server stores ciphertext
 * it never parses. Sealed dots until the vault key is in hand (the IDB cache
 * usually means it already is), and the decrypted log leaves the moment the vault
 * locks.
 *
 * Every save is the fin panel's seal → PUT → retry-once-on-409 dance over a PURE
 * transform, re-applied against freshly-fetched state on the conflict — so
 * logging a set on the phone while the PC has the page open can't lose either.
 * Nothing is optimistic: a set is on the page after it is sealed, not before.
 *
 * The in-progress draft is the one exception to all of that, and deliberately so
 * (see `GymDraft`): it is mirrored to localStorage in PLAINTEXT so a phone tab
 * that is backgrounded — or closed and reopened between exercises — can't eat a
 * workout, and cleared the moment the session saves.
 */
export function GymLog({ offline }: { offline: boolean }) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<GymConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [seqAlarm, setSeqAlarm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("log");
  // Restored as the state INITIALIZER rather than in an effect: no cascading
  // render, and no hydration risk either, because the builder cannot be on the
  // first paint — the vault always starts "loading", so both the server and the
  // first client render are the sealed block, whatever the draft holds.
  const [draft, setDraft] = useState<GymDraft>(readDraft);

  // Render-phase reset on the lock/unlock edge (the glance idiom): the decrypted
  // log leaves with the key. The DRAFT stays — it is the owner's own tab, mid
  // workout, and locking the vault shouldn't throw away sets not yet saved.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setCfg(null);
    setDataErr(null);
    setNotice(null);
  }

  /** Every draft mutation goes through here so the mirror can never drift. */
  function writeDraft(next: GymDraft) {
    setDraft(next);
    try {
      if (next.entries.length === 0 && !next.note)
        localStorage.removeItem(GYM_DRAFT_KEY);
      else localStorage.setItem(GYM_DRAFT_KEY, JSON.stringify(next));
    } catch {
      // best effort — a draft that can't be mirrored still works in memory
    }
  }

  // Load + decrypt once per unlock. A healthy 404 is first-run; anything else
  // must never look like it (the keystore lesson).
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      let config: GymConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/gym");
        if (res.status === 404) {
          config = EMPTY_GYM_CONFIG;
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope, GYM_CONTEXT);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeGymConfig(parsed);
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
      void checkSeqAndRemember("gym", config).then((rolled) => {
        if (rolled && !cancelled) setSeqAlarm(true);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  async function putConfig(
    next: GymConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    // Bump the sealed write counter (58b); prior = the newer of loaded state
    // and next itself (a 409-dance rebuild carries the fresher seq).
    next = { ...next, seq: Math.max(nextSeq(cfg ?? {}), nextSeq(next)) };
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "gym.json", t: "application/json", s: bytes.length },
      bytes,
      GYM_CONTEXT,
    );
    const res = await fetch("/api/gym", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-gym-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    if (res.ok) rememberSavedSeq("gym", next);
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<GymConfig> {
    const res = await fetch("/api/gym");
    if (res.status === 404) return EMPTY_GYM_CONFIG;
    if (res.status !== 200) throw new Error("gym refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope, GYM_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeGymConfig(parsed);
    if (!config) throw new Error("gym refetch: bad shape");
    return config;
  }

  /** Apply a pure transform, seal, PUT — retrying once against a fresh config on
   *  a 409 (the other device may have logged something meanwhile). */
  async function saveConfig(
    apply: (base: GymConfig) => GymConfig,
  ): Promise<boolean> {
    if (!cfg) return false;
    setBusy(true);
    setNotice(null);
    try {
      let base = cfg;
      // The cap is client-side law — refuse with a reason rather than let the
      // route answer an opaque 404 on an oversized frame.
      if (!fitsGymCap(apply(base))) {
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
          <SeqAlarm what="gym log" />
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

      {tab === "log" && (
        <LogView
          cfg={cfg}
          draft={draft}
          busy={busy}
          writeDraft={writeDraft}
          saveConfig={saveConfig}
        />
      )}
      {tab === "history" && (
        <HistoryView cfg={cfg} busy={busy} saveConfig={saveConfig} />
      )}
      {tab === "exercises" && (
        <ExercisesView cfg={cfg} busy={busy} saveConfig={saveConfig} />
      )}
      {tab === "templates" && (
        <TemplatesView cfg={cfg} busy={busy} saveConfig={saveConfig} />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------------
// log — the session builder
// -------------------------------------------------------------------------------

function LogView({
  cfg,
  draft,
  busy,
  writeDraft,
  saveConfig,
}: {
  cfg: GymConfig;
  draft: GymDraft;
  busy: boolean;
  writeDraft: (d: GymDraft) => void;
  saveConfig: (apply: (base: GymConfig) => GymConfig) => Promise<boolean>;
}) {
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Whether a session was begun THIS mount. The draft alone can't carry this:
   *  an empty start (no template exercises yet, or "empty") writes a draft with
   *  zero entries, which is indistinguishable from no draft at all — and the
   *  builder must still open so the first exercise can be added. Found on first
   *  real use: without this, a fresh install could never log anything. Not
   *  persisted on purpose — an empty begun-ness has nothing to lose with the tab. */
  const [begun, setBegun] = useState(false);
  /** The clock the rest line reads against, re-stamped once a second while there
   *  is a rest to count — a `m:ss` readout can't show finer than that, and no
   *  interval runs when the draft carries no stamp. A stamp newer than this
   *  reading (the tick a set was just logged on) reads 0, which is the truth. */
  const [now, setNow] = useState(restStamp);

  const started = begun || draft.entries.length > 0 || draft.note !== "";
  const restAt = draft.restAt;

  useEffect(() => {
    if (restAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [restAt]);

  /** Start a session from a template — one empty-ish set per exercise, prefilled
   *  from last time so a repeat workout is a few taps of confirmation. */
  function startFrom(template: GymTemplate | null) {
    const entries = (template?.exerciseIds ?? []).map((exerciseId) => ({
      exerciseId,
      sets: [prefillSet(cfg, exerciseId, [])],
    }));
    setBegun(true);
    writeDraft({
      ...(template ? { templateId: template.id } : {}),
      entries,
      note: "",
    });
  }

  /** A set added or removed is a set boundary — the closest honest proxy the
   *  log has for "that set is done" — so that is what the rest clock counts
   *  from. Editing a number is a correction, not a boundary: fixing last set's
   *  reps or dialling in the next weight mid-rest must not zero the clock (the
   *  rest line's tap is there when it really should). Nothing to press start on. */
  function setEntrySets(exerciseId: string, sets: GymSet[]) {
    const before = draft.entries.find((e) => e.exerciseId === exerciseId);
    const boundary = before === undefined || before.sets.length !== sets.length;
    writeDraft({
      ...draft,
      entries: draft.entries.map((e) =>
        e.exerciseId === exerciseId ? { ...e, sets } : e,
      ),
      ...(boundary ? { restAt: restStamp() } : {}),
    });
  }

  async function addToDraft(name: string) {
    const clean = name.trim();
    if (!clean) return;
    let id = findExerciseByName(cfg, clean);
    if (id === null) {
      // A name the catalog doesn't carry: mint it and seal it FIRST, so the
      // session can't end up referencing an exercise that was never stored.
      const minted = randomId();
      const ok = await saveConfig((b) => addExercise(b, minted, clean));
      if (!ok) return;
      id = minted;
    }
    if (!draft.entries.some((e) => e.exerciseId === id)) {
      writeDraft({
        ...draft,
        entries: [...draft.entries, { exerciseId: id, sets: [] }],
      });
    }
    setPick("");
    setPicking(false);
  }

  async function finish() {
    const session = draftToSession(draft, randomId(), sydneyToday());
    const ok = await saveConfig((b) => addSession(b, session));
    if (ok) {
      writeDraft(EMPTY_GYM_DRAFT);
      setConfirmDiscard(false);
      setBegun(false);
    }
  }

  if (!started) {
    return (
      <div className="px-4 py-4">
        <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
          start
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          {cfg.templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => startFrom(t)}
              className={btn}
            >
              {t.name}
            </button>
          ))}
          <button type="button" onClick={() => startFrom(null)} className={btn}>
            empty
          </button>
        </div>
        {cfg.templates.length === 0 && (
          <p className="mt-2 text-xs text-muted">
            no templates yet — start empty, or build one in templates
          </p>
        )}
      </div>
    );
  }

  const rest = restAt === undefined ? 0 : restSeconds(restAt, now);

  return (
    <div className="flex flex-col">
      {/* How long since the last set was touched. Tapping it starts the count
          again, for the rest that began before the phone came out. */}
      {restAt !== undefined && (
        <button
          type="button"
          aria-label="reset rest timer"
          onClick={() => writeDraft({ ...draft, restAt: restStamp() })}
          className={`border-b border-hairline px-4 py-2 text-left text-xs tabular-nums ${
            rest >= 180 ? "text-amber" : "text-muted"
          }`}
        >
          rest {formatRest(rest)}
        </button>
      )}
      {draft.entries.map((entry) => {
        const name = exerciseName(cfg, entry.exerciseId);
        const last = lastSetsFor(cfg, entry.exerciseId);
        return (
          <div
            key={entry.exerciseId}
            className="border-b border-hairline px-4 py-3"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-fg/90">
                {name ?? <span className="text-muted">unknown exercise</span>}
              </span>
              <button
                type="button"
                title="remove from this session"
                className="text-xs text-muted/50 transition-colors hover:text-down"
                onClick={() =>
                  writeDraft({
                    ...draft,
                    entries: draft.entries.filter(
                      (e) => e.exerciseId !== entry.exerciseId,
                    ),
                  })
                }
              >
                ×
              </button>
            </div>
            {last.length > 0 && (
              <p className="mt-0.5 text-[11px] tabular-nums text-muted">
                last: {setsLine(last)}
              </p>
            )}

            <div className="mt-2 flex flex-col gap-1.5">
              {entry.sets.map((set, i) => (
                <SetRow
                  key={i}
                  set={set}
                  pr={isPr(set, cfg, entry.exerciseId)}
                  onChange={(next) =>
                    setEntrySets(
                      entry.exerciseId,
                      entry.sets.map((s, j) => (j === i ? next : s)),
                    )
                  }
                  onRemove={() =>
                    setEntrySets(
                      entry.exerciseId,
                      entry.sets.filter((_, j) => j !== i),
                    )
                  }
                />
              ))}
              <button
                type="button"
                className={`${btn} self-start text-xs`}
                onClick={() =>
                  setEntrySets(entry.exerciseId, [
                    ...entry.sets,
                    prefillSet(cfg, entry.exerciseId, entry.sets),
                  ])
                }
              >
                + set
              </button>
            </div>
          </div>
        );
      })}

      <div className="flex flex-col gap-2 border-b border-hairline px-4 py-3">
        {picking ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              list="gym-exercise-names"
              value={pick}
              disabled={busy}
              autoFocus
              onChange={(e) => setPick(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addToDraft(pick)}
              placeholder="exercise name"
              className={`min-w-0 flex-1 ${input}`}
              aria-label="exercise to add"
            />
            <datalist id="gym-exercise-names">
              {cfg.exercises.map((e) => (
                <option key={e.id} value={e.name} />
              ))}
            </datalist>
            <button
              type="button"
              className={btn}
              disabled={busy || !pick.trim()}
              onClick={() => void addToDraft(pick)}
            >
              {busy ? "…" : "add"}
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setPicking(false);
                setPick("");
              }}
            >
              cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`${btn} self-start text-xs`}
            onClick={() => setPicking(true)}
          >
            + exercise
          </button>
        )}

        <input
          type="text"
          value={draft.note}
          disabled={busy}
          onChange={(e) => writeDraft({ ...draft, note: e.target.value })}
          placeholder="note (optional)"
          className={input}
          aria-label="session note"
        />
      </div>

      <div className="flex items-center gap-3 px-4 py-3 text-xs">
        <button
          type="button"
          className={btn}
          disabled={busy || !draftHasSets(draft)}
          onClick={() => void finish()}
        >
          {busy ? "saving…" : "finish & save"}
        </button>
        <button
          type="button"
          className="text-muted transition-colors hover:text-down"
          disabled={busy}
          onClick={() => {
            if (confirmDiscard) {
              writeDraft(EMPTY_GYM_DRAFT);
              setConfirmDiscard(false);
              setBegun(false);
            } else setConfirmDiscard(true);
          }}
        >
          {confirmDiscard ? "discard?" : "discard"}
        </button>
      </div>
    </div>
  );
}

/**
 * One numeric cell of a set row. A text input rather than type="number", on
 * purpose: a controlled number input snaps a cleared field straight back to 0,
 * so typing lands beside the prefill ("050"). Here the cell owns its text while
 * focused — focusing selects the whole value so typing replaces it, an empty
 * field stays empty under the cursor (the draft holds 0 meanwhile), and blur
 * settles the display back to the canonical number. `inputMode` still brings up
 * the right phone keypad; `parseSetInput` refuses non-numeric keystrokes.
 */
function NumCell({
  value,
  integer,
  width,
  ariaLabel,
  onCommit,
}: {
  value: number;
  integer: boolean;
  width: string;
  ariaLabel: string;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      value={text ?? String(value)}
      onFocus={(e) => {
        setText(String(value));
        e.target.select();
      }}
      onChange={(e) => {
        const parsed = parseSetInput(e.target.value, integer);
        if (parsed === null) return;
        setText(e.target.value);
        onCommit(parsed);
      }}
      onBlur={() => setText(null)}
      className={`${width} text-right tabular-nums ${input}`}
      aria-label={ariaLabel}
    />
  );
}

/** One set: weight and reps, each with its own steppers, and the PR chip. */
function SetRow({
  set,
  pr,
  onChange,
  onRemove,
}: {
  set: GymSet;
  pr: boolean;
  onChange: (next: GymSet) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[13px]">
      <button
        type="button"
        className={step}
        aria-label="less weight"
        onClick={() =>
          onChange({ ...set, w: Math.max(0, set.w - WEIGHT_STEP) })
        }
      >
        −
      </button>
      <NumCell
        value={set.w}
        integer={false}
        width="w-16"
        ariaLabel="weight in kg"
        onCommit={(w) => onChange({ ...set, w })}
      />
      <button
        type="button"
        className={step}
        aria-label="more weight"
        onClick={() => onChange({ ...set, w: set.w + WEIGHT_STEP })}
      >
        +
      </button>
      <span className="text-muted">×</span>
      <button
        type="button"
        className={step}
        aria-label="fewer reps"
        onClick={() => onChange({ ...set, r: Math.max(0, set.r - 1) })}
      >
        −
      </button>
      <NumCell
        value={set.r}
        integer
        width="w-12"
        ariaLabel="reps"
        onCommit={(r) => onChange({ ...set, r })}
      />
      <button
        type="button"
        className={step}
        aria-label="more reps"
        onClick={() => onChange({ ...set, r: set.r + 1 })}
      >
        +
      </button>
      {pr && (
        <span
          title="beats the best set logged for this exercise"
          className="border border-amber/40 px-1 text-[10px] uppercase tracking-[0.08em] text-amber"
        >
          pr
        </span>
      )}
      <button
        type="button"
        aria-label="remove set"
        className="ml-auto text-muted/50 transition-colors hover:text-down"
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}

// -------------------------------------------------------------------------------
// history
// -------------------------------------------------------------------------------

function HistoryView({
  cfg,
  busy,
  saveConfig,
}: {
  cfg: GymConfig;
  busy: boolean;
  saveConfig: (apply: (base: GymConfig) => GymConfig) => Promise<boolean>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const used = gymPayloadBytes(cfg);
  // Trailing 7-day windows, so the newest bar is the week being trained and the
  // one before it is the fair comparison. Reading the clock in render is safe
  // here for the draft initializer's reason: this view only exists behind an
  // unlocked vault, which the first paint never is.
  const series = weeklyVolume(cfg, 10, sydneyToday());
  const thisWeek = series[9];
  const lastWeek = series[8];
  // Two trained weeks is the minimum a line can mean anything with — until then
  // the numbers alone are the honest reading.
  const plottable = series.filter((v) => v > 0).length >= 2;

  async function remove(id: string) {
    const ok = await saveConfig((b) => removeSession(b, id));
    if (ok) {
      setConfirmDelete(null);
      setOpenId(null);
    }
  }

  return (
    <div className="flex flex-col">
      {/* Total kilograms moved per week — the one number that answers "am I
          doing more than I was", where a single session's volume can't. */}
      {cfg.sessions.length > 0 && (
        <div className="border-b border-hairline px-4 py-3">
          <p className="mb-1 flex items-baseline gap-3 text-[11px] uppercase tracking-[0.12em] text-muted">
            <span>volume · 10 wk</span>
            <span className="ml-auto normal-case tracking-normal tabular-nums">
              this week {commas(Math.round(thisWeek))}kg · last{" "}
              {commas(Math.round(lastWeek))}kg
            </span>
          </p>
          {plottable && (
            <Sparkline
              values={series}
              delta={thisWeek - lastWeek}
              height={28}
              label="weekly training volume"
            />
          )}
        </div>
      )}

      {cfg.sessions.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted">
          nothing logged yet — start a session in log
        </p>
      ) : (
        cfg.sessions.map((s) => {
          const open = openId === s.id;
          const tpl = s.templateId ? templateName(cfg, s.templateId) : null;
          return (
            <div key={s.id} className="border-b border-hairline">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : s.id)}
                className="flex w-full flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-left text-sm transition-colors hover:text-amber"
              >
                <span className="tabular-nums text-fg/90">{s.date}</span>
                {tpl && <span className="text-xs text-muted">{tpl}</span>}
                <span className="ml-auto text-xs tabular-nums text-muted">
                  {s.entries.length}{" "}
                  {s.entries.length === 1 ? "exercise" : "exercises"} ·{" "}
                  {commas(Math.round(sessionVolume(s)))}kg
                </span>
              </button>
              {open && (
                <div className="px-4 pb-3 text-xs">
                  {s.entries.map((e) => (
                    <p key={e.exerciseId} className="tabular-nums">
                      <span className="text-fg/80">
                        {exerciseName(cfg, e.exerciseId) ?? "unknown exercise"}
                      </span>{" "}
                      <span className="text-muted">{setsLine(e.sets)}</span>
                    </p>
                  ))}
                  {s.note && <p className="mt-1 text-muted/70">{s.note}</p>}
                  {/* two-tap delete (the transit idiom) — a mis-log or a test
                      session must be removable, or it poisons PR detection
                      and the week counts forever. */}
                  <button
                    type="button"
                    disabled={busy}
                    className="mt-2 text-muted/60 transition-colors hover:text-down disabled:opacity-30"
                    onClick={() => {
                      if (confirmDelete === s.id) void remove(s.id);
                      else setConfirmDelete(s.id);
                    }}
                  >
                    {busy && confirmDelete === s.id
                      ? "deleting…"
                      : confirmDelete === s.id
                        ? "delete this session?"
                        : "delete"}
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {/* The honest cap readout — the log is one fixed envelope, so its ceiling
          is a real number and worth showing rather than discovering. */}
      <p className="px-4 py-2.5 text-[11px] tabular-nums text-muted/60">
        envelope · {commas(used)} / {commas(GYM_MAX_BYTES)} bytes ·{" "}
        {cfg.sessions.length} sessions
      </p>
    </div>
  );
}

// -------------------------------------------------------------------------------
// exercises
// -------------------------------------------------------------------------------

function ExercisesView({
  cfg,
  busy,
  saveConfig,
}: {
  cfg: GymConfig;
  busy: boolean;
  saveConfig: (apply: (base: GymConfig) => GymConfig) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function rename(id: string) {
    const ok = await saveConfig((b) => renameExercise(b, id, name));
    if (ok) setEditing(null);
  }

  if (cfg.exercises.length === 0)
    return (
      <p className="px-4 py-4 text-xs text-muted">
        no exercises yet — they are created as you log them
      </p>
    );

  const today = sydneyToday();

  return (
    <div className="flex flex-col">
      {cfg.exercises.map((e) => {
        const best = bestFor(cfg, e.id);
        const top = bestE1rm(cfg, e.id);
        const series = e1rmSeries(cfg, e.id);
        const done = lastDoneFor(cfg, e.id);
        const stalled = plateauWeeks(cfg, e.id, today);
        return (
          <div key={e.id} className="border-b border-hairline px-4 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {editing === e.id ? (
                <>
                  <input
                    type="text"
                    value={name}
                    disabled={busy}
                    autoFocus
                    onChange={(ev) => setName(ev.target.value)}
                    onKeyDown={(ev) => ev.key === "Enter" && void rename(e.id)}
                    className={`min-w-0 flex-1 ${input}`}
                    aria-label="exercise name"
                  />
                  <button
                    type="button"
                    className={`${btn} text-xs`}
                    disabled={busy || !name.trim()}
                    onClick={() => void rename(e.id)}
                  >
                    save
                  </button>
                  <button
                    type="button"
                    className={`${btn} text-xs`}
                    onClick={() => setEditing(null)}
                  >
                    cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="text-sm text-fg/90">{e.name}</span>
                  <span className="text-xs tabular-nums text-muted">
                    {best ? `best ${best.w}×${best.r}` : "no sets yet"}
                    {top &&
                      top.e1rm > 0 &&
                      ` · e1rm ~${Math.round(top.e1rm)}kg`}
                    {done && ` · last ${done}`}
                    {/* Trained since, and still no better than it was — see
                        `plateauWeeks` for what earns the word. */}
                    {stalled !== null && (
                      <span className="text-amber"> · plateau {stalled}wk</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="ml-auto text-[11px] text-muted/60 transition-colors hover:text-amber"
                    onClick={() => {
                      setEditing(e.id);
                      setName(e.name);
                    }}
                  >
                    rename
                  </button>
                </>
              )}
            </div>
            {/* The estimated 1RM over every session that included it — the
                honest progression when the reps move around under the weight
                (see `epley`). Two points is the minimum a line can mean
                anything with. */}
            {series.length >= 2 && (
              <div className="mt-1">
                <Sparkline
                  values={series}
                  delta={series[series.length - 1] - series[0]}
                  height={28}
                  label={`${e.name} estimated 1RM progression`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------------------------
// templates
// -------------------------------------------------------------------------------

function TemplatesView({
  cfg,
  busy,
  saveConfig,
}: {
  cfg: GymConfig;
  busy: boolean;
  saveConfig: (apply: (base: GymConfig) => GymConfig) => Promise<boolean>;
}) {
  const [edit, setEdit] = useState<GymTemplate | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  /** Type a name the catalog doesn't carry yet — mint it and seal it FIRST
   *  (the addToDraft discipline), then add it to the template being edited.
   *  Without this, a fresh install had no way to build a real template: the
   *  catalog only grew from logged sessions, and an empty template couldn't
   *  start one (found on first real use). */
  async function mintExercise() {
    if (!edit) return;
    const clean = newName.trim();
    if (!clean) return;
    let id = findExerciseByName(cfg, clean);
    if (id === null) {
      const minted = randomId();
      const ok = await saveConfig((b) => addExercise(b, minted, clean));
      if (!ok) return;
      id = minted;
    }
    if (!edit.exerciseIds.includes(id))
      setEdit({ ...edit, exerciseIds: [...edit.exerciseIds, id] });
    setNewName("");
  }

  function move(ids: string[], from: number, to: number): string[] {
    if (to < 0 || to >= ids.length) return ids;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  }

  async function save() {
    if (!edit) return;
    const ok = await saveConfig((b) => upsertTemplate(b, edit));
    if (ok) setEdit(null);
  }

  if (edit) {
    const chosen = edit.exerciseIds;
    return (
      <div className="flex flex-col gap-3 px-4 py-4">
        <input
          type="text"
          value={edit.name}
          disabled={busy}
          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          placeholder="template name"
          className={input}
          aria-label="template name"
        />

        <div className="flex flex-col gap-1">
          {chosen.length === 0 && (
            <p className="text-xs text-muted">
              no exercises yet — add them from below
            </p>
          )}
          {chosen.map((id, i) => (
            <div key={id} className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 text-fg/90">
                {exerciseName(cfg, id) ?? "unknown exercise"}
              </span>
              <button
                type="button"
                className={step}
                aria-label="move up"
                disabled={i === 0}
                onClick={() =>
                  setEdit({ ...edit, exerciseIds: move(chosen, i, i - 1) })
                }
              >
                ↑
              </button>
              <button
                type="button"
                className={step}
                aria-label="move down"
                disabled={i === chosen.length - 1}
                onClick={() =>
                  setEdit({ ...edit, exerciseIds: move(chosen, i, i + 1) })
                }
              >
                ↓
              </button>
              <button
                type="button"
                aria-label="remove from template"
                className="text-muted/50 transition-colors hover:text-down"
                onClick={() =>
                  setEdit({
                    ...edit,
                    exerciseIds: chosen.filter((x) => x !== id),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-hairline pt-3 text-xs">
          {cfg.exercises
            .filter((e) => !chosen.includes(e.id))
            .map((e) => (
              <button
                key={e.id}
                type="button"
                className={btn}
                onClick={() =>
                  setEdit({ ...edit, exerciseIds: [...chosen, e.id] })
                }
              >
                + {e.name}
              </button>
            ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <input
            type="text"
            value={newName}
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void mintExercise()}
            placeholder="new exercise name"
            className={`flex-1 ${input}`}
            aria-label="new exercise name"
          />
          <button
            type="button"
            className={btn}
            disabled={busy || !newName.trim()}
            onClick={() => void mintExercise()}
          >
            + add
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            className={btn}
            disabled={busy || !edit.name.trim()}
            onClick={() => void save()}
          >
            {busy ? "saving…" : "save template"}
          </button>
          <button
            type="button"
            className="text-muted transition-colors hover:text-amber"
            onClick={() => setEdit(null)}
          >
            cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {cfg.templates.map((t) => (
        <div
          key={t.id}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-4 py-2.5"
        >
          <span className="text-sm text-fg/90">{t.name}</span>
          <span className="min-w-0 flex-1 text-xs text-muted">
            {t.exerciseIds
              .map((id) => exerciseName(cfg, id) ?? "unknown")
              .join(" · ")}
          </span>
          <button
            type="button"
            className="text-[11px] text-muted/60 transition-colors hover:text-amber"
            onClick={() => setEdit(t)}
          >
            edit
          </button>
          <button
            type="button"
            disabled={busy}
            className="text-[11px] text-muted/60 transition-colors hover:text-down"
            onClick={() => {
              if (confirmDelete === t.id) {
                void saveConfig((b) => removeTemplate(b, t.id));
                setConfirmDelete(null);
              } else setConfirmDelete(t.id);
            }}
          >
            {confirmDelete === t.id ? "delete?" : "delete"}
          </button>
        </div>
      ))}
      <div className="px-4 py-3">
        <button
          type="button"
          className={`${btn} text-xs`}
          onClick={() => setEdit({ id: randomId(), name: "", exerciseIds: [] })}
        >
          + template
        </button>
      </div>
    </div>
  );
}
