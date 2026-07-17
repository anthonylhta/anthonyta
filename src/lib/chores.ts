/**
 * chores — the pure spine of the maintenance-chores row (roadmap 52). The hub
 * has recurring chores (the weekly CSV import, vault-sync after journaling,
 * the monthly hub-backup) that lived in notes and memory — places the owner
 * doesn't look every morning. This row derives "last done" from EVIDENCE, not
 * self-reporting: a chip goes green because the chore actually happened.
 *
 * Sources, per chore (the row composes all three):
 *   - csv import  → the newest invested[] date inside the DECRYPTED fin
 *     envelope (client island — exact evidence, sealed at rest)
 *   - vault-sync  → R2 `LastModified` on the search index (server-side; the
 *     "when" of a blob is inside the accepted metadata boundary)
 *   - hub-backup  → a plaintext date stamp the backup script writes on
 *     success (an off-hub chore is otherwise invisible to the hub)
 */

/** Where the backup script stamps its completion (plaintext ISO date). */
export const BACKUP_STAMP_PATH = "meta/chores/backup";

export const CHORE_CADENCE_DAYS = {
  csv: 7,
  vaultSync: 3,
  backup: 30,
} as const;

export type ChoreStatus = "ok" | "due" | "overdue" | "unknown";

export interface ChoreState {
  ageDays: number | null;
  status: ChoreStatus;
}

/** Whole days from `iso` to `now`; null when `iso` doesn't parse. A bare
 *  `YYYY-MM-DD` (the CSV chore's evidence) parses as UTC midnight — up to
 *  10h before the Sydney midnight it means — so an age can read one day
 *  high around Sydney mornings. Immaterial at ≥3-day cadences. */
export function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((now.getTime() - ms) / 86_400_000));
}

/** ok under the cadence, due at it, overdue at twice it; unknown = no record
 *  (a missing stamp nags gently rather than pretending freshness). */
export function choreState(
  lastIso: string | null,
  cadenceDays: number,
  now: Date,
): ChoreState {
  const ageDays = daysSince(lastIso, now);
  if (ageDays === null) return { ageDays: null, status: "unknown" };
  if (ageDays >= cadenceDays * 2) return { ageDays, status: "overdue" };
  if (ageDays >= cadenceDays) return { ageDays, status: "due" };
  return { ageDays, status: "ok" };
}
