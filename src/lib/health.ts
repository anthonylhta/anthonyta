/**
 * health — the pure spine of the project-health band (roadmap 55). The hub
 * aggregates its sibling projects' data but couldn't say whether they were
 * UP; this row pings each live deployment and reads the answer at a glance.
 * Targets are constants like the Sydney coordinates — they're this owner's
 * estate, not configuration.
 */

export interface HealthTarget {
  key: string;
  label: string;
  url: string;
}

export const HEALTH_TARGETS: HealthTarget[] = [
  { key: "riichi", label: "riichi", url: "https://riichi.anthonyta.dev" },
  { key: "novel", label: "webnovel", url: "https://novel.anthonyta.dev" },
  { key: "ishin", label: "ishin", url: "https://ishin.io" },
];

/** A 2xx slower than this reads as degraded, not healthy. */
export const SLOW_MS = 1500;

export type HealthState = "ok" | "slow" | "down";

export interface HealthResult {
  key: string;
  label: string;
  state: HealthState;
  /** Round-trip in ms; null when the probe failed outright. */
  ms: number | null;
}

/** One probe's verdict: reachable-and-quick, reachable-but-slow, or down. */
export function classifyHealth(ok: boolean, ms: number | null): HealthState {
  if (!ok) return "down";
  return ms !== null && ms >= SLOW_MS ? "slow" : "ok";
}
