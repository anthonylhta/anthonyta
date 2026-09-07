import type { AperturePlatformBar } from "./aperture";
import { isValidSeq } from "./seqrule";

/**
 * circlemarks — the circle's live ledger: the ONE bar standing open right now,
 * and the ones met since the last seal, written from /aperture the moment they
 * happen and folded into the seal at the check-in (the gu-marks pattern,
 * ADR 0175).
 *
 * THE FLAW IS THE SCHEMA. The skill's own limit — the circle cannot be redrawn
 * until the spoken bar is met or judged — is enforced here rather than in the
 * UI: `open` is a single bar, not a list, and `drawCircle` refuses while one
 * stands. That refusal is the whole point of the store; a list of open vows
 * would be a to-do list wearing the skill's name, which is exactly the failure
 * mode the amendment was written against.
 *
 * THE SEAL STAYS AUTHORITATIVE. A mark here is a log, not a ruling: the
 * check-in reads it, writes the met bar into `platform.circle[]`, and
 * `reconcileCircle` retires the pending row by itself the next time the page
 * opens. An open bar whose date has passed is retired the same way — it was
 * judged at the deadline, and the circle is redrawn.
 */

export const CIRCLE_MAX_BYTES = 65_536;

/** A bar spoken inside the circle: what was said, when, and when it comes due. */
export interface CircleBar {
  said: string;
  /** The day it was spoken, `YYYY-MM-DD`. */
  on: string;
  /** The day it comes due — never before the day it was spoken. */
  due: string;
}

/** The same bar, kept: the day it was met rides with it until a seal folds it. */
export interface CircleMetBar extends CircleBar {
  met: string;
}

export interface CircleConfig {
  v: 1;
  /** The sealed write counter (ADR 0108's 58b) — see lib/seqrule. */
  seq?: number;
  /** The bar standing right now. At most one, ever. */
  open?: CircleBar;
  /** Met but unsealed — the rows Wednesday's check-in folds in. */
  met: CircleMetBar[];
}

export const EMPTY_CIRCLE: CircleConfig = { v: 1, met: [] };

/** Pending met bars between two seals. A week cannot hold fifty kept vows at
 *  one open bar a time; the cap is an envelope guard, not a pace. */
const MAX_MET = 50;
const MAX_SAID = 400;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
function isDay(x: unknown): x is string {
  return (
    typeof x === "string" && DAY_RE.test(x) && !Number.isNaN(Date.parse(x))
  );
}
function isSaid(x: unknown): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= MAX_SAID;
}

function normBar(x: unknown): CircleBar | null {
  if (!isObj(x)) return null;
  if (!isSaid(x.said) || !isDay(x.on) || !isDay(x.due)) return null;
  // A bar due before it was spoken is already broken — a shape, not a state.
  if (x.due < x.on) return null;
  return { said: x.said, on: x.on, due: x.due };
}

function normMetBar(x: unknown): CircleMetBar | null {
  const bar = normBar(x);
  if (!bar || !isObj(x)) return null;
  if (!isDay(x.met) || x.met < bar.on) return null;
  return { ...bar, met: x.met };
}

/** The whole record → a config, or null when the FRAME is wrong. Strict: one
 *  bad row rejects the record, the way every sealed config here rejects. */
export function normalizeCircle(x: unknown): CircleConfig | null {
  if (!isObj(x) || x.v !== 1) return null;
  if (!isValidSeq(x.seq)) return null;
  if (!Array.isArray(x.met) || x.met.length > MAX_MET) return null;
  const met: CircleMetBar[] = [];
  for (const row of x.met) {
    const bar = normMetBar(row);
    if (bar === null) return null;
    met.push(bar);
  }
  let open: CircleBar | undefined;
  if (x.open !== undefined) {
    const bar = normBar(x.open);
    if (bar === null) return null;
    open = bar;
  }
  return {
    v: 1,
    ...(x.seq !== undefined ? { seq: x.seq as number } : {}),
    ...(open !== undefined ? { open } : {}),
    met,
  };
}

// --- transforms (pure; the component seals and PUTs the result) ---------------

/**
 * Draw the circle around one bar. Returns the config UNCHANGED when a bar is
 * already open (one circle at a time — the flaw, literally) or when the bar
 * itself is malformed. Refusing rather than throwing keeps the caller's typed
 * text alive: the form stays as it is and the page says nothing new.
 */
export function drawCircle(cfg: CircleConfig, bar: CircleBar): CircleConfig {
  if (cfg.open !== undefined) return cfg;
  const norm = normBar(bar);
  if (norm === null) return cfg;
  return { ...cfg, open: norm };
}

/** The record with its circle rubbed out — the one place `open` is removed. */
function withoutOpen(cfg: CircleConfig): CircleConfig {
  const next = { ...cfg };
  delete next.open;
  return next;
}

/** A false start, rubbed out before the seal — the circle is simply not drawn. */
export function clearCircle(cfg: CircleConfig): CircleConfig {
  return cfg.open === undefined ? cfg : withoutOpen(cfg);
}

/**
 * The bar was kept, on `day`. Moves the open bar into the pending list; no open
 * bar, a day before the bar was spoken, or a full list leaves the config alone.
 */
export function meetBar(cfg: CircleConfig, day: string): CircleConfig {
  const open = cfg.open;
  if (open === undefined) return cfg;
  if (!isDay(day) || day < open.on) return cfg;
  if (cfg.met.length >= MAX_MET) return cfg;
  return { ...withoutOpen(cfg), met: [...cfg.met, { ...open, met: day }] };
}

/**
 * Retire what the seal has caught up with: a pending met bar the seal now
 * carries (same words, same day spoken), and an open bar whose deadline fell
 * before the newest seal — it was judged there, so the circle is free to be
 * redrawn. Returns the SAME object when nothing changed, so a caller can skip
 * the write.
 */
export function reconcileCircle(
  cfg: CircleConfig,
  sealed: { sealedAt: string; circle?: readonly AperturePlatformBar[] },
): CircleConfig {
  const carried = new Set(
    (sealed.circle ?? [])
      .filter((b) => b.met !== undefined)
      .map((b) => `${b.on}|${b.said}`),
  );
  const met = cfg.met.filter((b) => !carried.has(`${b.on}|${b.said}`));
  const sealDay = sealed.sealedAt.slice(0, 10);
  const judged = cfg.open !== undefined && cfg.open.due < sealDay;
  if (met.length === cfg.met.length && !judged) return cfg;
  return judged ? { ...withoutOpen(cfg), met } : { ...cfg, met };
}
