import type { ApertureDoc, ApertureGlance, ApertureTrial } from "./aperture";

/**
 * apertureview — the pure view spine of the status band and its detail island.
 * Every decision the two components make lives here: which of the six island
 * states to render, which literal Tailwind class a colour or a status wears, how a
 * date turns into a countdown, which trials collapse behind the "+n" toggle. The
 * components are thin JSX over these values and hold no branching logic of their
 * own.
 *
 * That split is the house testing discipline, not an abstraction for its own sake:
 * vitest runs node-env here, so a component's behaviour is only testable once it is
 * a function over data (`money.tone`, `chores.choreState` are the precedents). The
 * "component tests" for this module are `apertureview.test.ts`.
 *
 * Two rules the whole file obeys:
 *   - EVERY class is a static literal string. Tailwind's JIT scans source text, so
 *     a computed `text-${token}` would compile to nothing and render invisible —
 *     the TftStrip `CELL` pattern, applied to a 24-entry canon.
 *   - Anything this build doesn't recognise renders MUTED, never dropped and never
 *     dressed as known. lib/aperture keeps its vocabularies open on purpose; this
 *     is the other half of that bargain.
 *
 * Pure and clock-less like lib/aperture: every time-dependent function takes its
 * instant as an argument (the `isSealStale` discipline).
 */

const DAY_MS = 86_400_000;

// --- the island's six states --------------------------------------------------

/** The detail island's entire state space — one branch of its render, each. */
export type ApertureDetailStatus =
  | "offline"
  | "sealed"
  | "decrypting"
  | "unreachable"
  | "tamper"
  | "ready";

/**
 * Which state the detail island is in, given the vault machine's status, whatever
 * went wrong fetching the document, and the document itself. Precedence is
 * load-bearing: "offline" beats everything (with crypto off entirely there is
 * nothing to unlock toward, so no error is worth reporting), and a data error only
 * counts once the vault is actually unlocked — a fetch that failed while locked is
 * a stale fact about a state the owner has already left.
 */
export function detailStatus(
  vaultStatus: string,
  dataErr: "unreachable" | "tamper" | null,
  doc: ApertureDoc | null,
): ApertureDetailStatus {
  if (vaultStatus === "offline") return "offline";
  if (vaultStatus !== "unlocked") return "sealed";
  if (doc) return "ready";
  if (dataErr) return dataErr;
  return "decrypting";
}

// --- the essence canon, as classes --------------------------------------------

/**
 * Canon essence name → the literal text class over its @theme token. Keyed by the
 * exact strings `essenceOf` returns; the test iterates the canon tables so adding
 * a rank without a colour token fails there rather than rendering an invisible
 * name in production.
 */
export const ESSENCE_TEXT: Record<string, string> = {
  "Jade Green": "text-jade-green",
  "Pale Green": "text-pale-green",
  "Dark Green": "text-dark-green",
  "Black Green": "text-black-green",
  "Light Red": "text-light-red",
  Scarlet: "text-scarlet",
  Crimson: "text-crimson",
  "Dark Red": "text-dark-red",
  "Light Silver": "text-light-silver",
  "Blossom Silver": "text-blossom-silver",
  "Bright Silver": "text-bright-silver",
  "Snow Silver": "text-snow-silver",
  "Light Gold": "text-light-gold",
  "Bright Gold": "text-bright-gold",
  "Essence Gold": "text-essence-gold",
  "True Gold": "text-true-gold",
  "Light Purple": "text-light-purple",
  Violet: "text-violet",
  "Deep Purple": "text-deep-purple",
  "Crystal Purple": "text-crystal-purple",
  "Green Grape": "text-green-grape",
  "Red Date": "text-red-date",
  "White Litchi": "text-white-litchi",
  "Yellow Apricot": "text-yellow-apricot",
};

/** The same canon as swatch fills — the band's 2.5×2.5 square. */
export const ESSENCE_SWATCH: Record<string, string> = {
  "Jade Green": "bg-jade-green",
  "Pale Green": "bg-pale-green",
  "Dark Green": "bg-dark-green",
  "Black Green": "bg-black-green",
  "Light Red": "bg-light-red",
  Scarlet: "bg-scarlet",
  Crimson: "bg-crimson",
  "Dark Red": "bg-dark-red",
  "Light Silver": "bg-light-silver",
  "Blossom Silver": "bg-blossom-silver",
  "Bright Silver": "bg-bright-silver",
  "Snow Silver": "bg-snow-silver",
  "Light Gold": "bg-light-gold",
  "Bright Gold": "bg-bright-gold",
  "Essence Gold": "bg-essence-gold",
  "True Gold": "bg-true-gold",
  "Light Purple": "bg-light-purple",
  Violet: "bg-violet",
  "Deep Purple": "bg-deep-purple",
  "Crystal Purple": "bg-crystal-purple",
  "Green Grape": "bg-green-grape",
  "Red Date": "bg-red-date",
  "White Litchi": "bg-white-litchi",
  "Yellow Apricot": "bg-yellow-apricot",
};

/** The class every unknown thing wears — one literal, one doctrine. */
const MUTED = "text-muted";

/** A canon name's text class; no canon (or a name this build never heard of)
 *  renders muted rather than picking a colour nobody assigned. */
export function essenceTextClass(name: string | null): string {
  return (name && ESSENCE_TEXT[name]) || MUTED;
}

/** A canon name's swatch class, or null — no canon means NO swatch at all, not a
 *  grey one: an unpainted square would read as a colour the canon never gave. */
export function essenceSwatchClass(name: string | null): string | null {
  return (name && ESSENCE_SWATCH[name]) || null;
}

// --- condition chips -----------------------------------------------------------

/** The neutral chip: unknown statuses AND the two known statuses that must not
 *  imply anything is going wrong. */
const MUTED_CHIP = "border-hairline text-muted";

const CONDITION_CHIP: Record<string, string> = {
  not_held: MUTED_CHIP,
  hardening: "border-amber/40 text-amber",
  held: "border-up/40 text-up",
  hardened: "border-up/60 text-up",
  failing: "border-down/50 text-down",
  // The tribulation exemption, honoured in CSS: a SUSPENDED condition was paused
  // by the adjudicator, not broken by the owner, so it must never wear a `down`
  // (red) class — red here would read as failure and be a lie every time. It gets
  // the neutral chip, and the ⏸ prefix below carries the whole meaning.
  suspended: MUTED_CHIP,
};

/** A condition status's chip class; an unknown status gets the muted chip. */
export function conditionChipClass(status: string): string {
  return CONDITION_CHIP[status] ?? MUTED_CHIP;
}

/** The glyph that opens a chip — only `suspended` gets one, because it is the one
 *  status whose colour deliberately says nothing. */
export function conditionChipPrefix(status: string): string {
  return status === "suspended" ? "⏸ " : "";
}

// --- dates ---------------------------------------------------------------------

/**
 * Whole days from `nowMs` until `iso`, rounded UP (a date 12h away is "1d", never
 * "0d"); negative once the date is past. Null on anything unparseable — a broken
 * date must never render as a number. The clock is injected, like lib/aperture's.
 */
export function daysUntil(iso: string, nowMs: number): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - nowMs) / DAY_MS);
}

/**
 * How a trial's date reads on the row. No date at all is "unscheduled" — the
 * honest state, not an omission. A future date becomes a restrained countdown
 * ("in 41d"); a past or today's date shows AS the date, because a resolved trial
 * is a fact with a day attached and counting down to it would be nonsense. An
 * unparseable string passes through as the literal, per the muted-literal rule.
 */
export function trialSchedule(
  date: string | null | undefined,
  nowMs: number,
): string {
  if (date === null || date === undefined) return "unscheduled";
  const days = daysUntil(date, nowMs);
  if (days === null) return date;
  return days > 0 ? `in ${days}d` : date;
}

/**
 * How long ago the seal was taken — "sealed today" under a full day, "sealed 3d
 * ago" past it (floored: the elapsed days actually completed). Null on an
 * unparseable seal, so the band shows no age rather than a wrong one.
 */
export function sealedAgo(sealedAt: string, nowMs: number): string | null {
  const t = Date.parse(sealedAt);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((nowMs - t) / DAY_MS);
  return days < 1 ? "sealed today" : `sealed ${days}d ago`;
}

// --- trials --------------------------------------------------------------------

/**
 * Split trials into what is still live and what is settled. An UNKNOWN state
 * lands in `open`, deliberately: resolved trials collapse behind a toggle, so
 * treating an unrecognised state as resolved would HIDE it — and the one thing
 * the open vocabulary must never do is make a newer emitter's trial disappear.
 */
export function splitTrials(trials: ApertureTrial[]): {
  open: ApertureTrial[];
  resolved: ApertureTrial[];
} {
  const isResolved = (t: ApertureTrial) =>
    t.state === "passed" || t.state === "failed";
  return {
    open: trials.filter((t) => !isResolved(t)),
    resolved: trials.filter(isResolved),
  };
}

// --- the band's one line -------------------------------------------------------

/** The zero-tap line: "RANK 3 · UPPER". The stage is uppercased whether or not
 *  this build knows it — it's a literal either way, and an unknown stage still
 *  belongs on the band. */
export function bandLine(glance: ApertureGlance): string {
  return `RANK ${glance.rank} · ${glance.stage.toUpperCase()}`;
}
