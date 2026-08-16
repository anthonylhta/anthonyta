/**
 * chores — the pure spine of the needs-doing board's cadence lines (roadmap 52,
 * then 72). The hub has recurring things (journaling, training, the weekly CSV
 * import, vault-sync, the monthly hub-backup, the weekly aperture seal) that
 * lived in notes and memory — places the owner doesn't look every morning. Each
 * line derives "last done" from EVIDENCE, not self-reporting: a row goes quiet
 * because the thing actually happened.
 *
 * Sources, per cadence (the board composes them all):
 *   - gym         → the newest session date inside the DECRYPTED gym envelope
 *   - csv import  → the newest invested[] date inside the DECRYPTED fin
 *     envelope (client islands — exact evidence, sealed at rest)
 *   - vault-sync  → R2 `LastModified` on the search index (server-side; the
 *     "when" of a blob is inside the accepted metadata boundary)
 *   - aperture    → R2 `LastModified` on the plaintext glance, written by the
 *     owner-run sync at each seal
 *   - hub-backup  → a plaintext date stamp the backup script writes on
 *     success (an off-hub chore is otherwise invisible to the hub)
 */

/** Where the backup script stamps its completion (plaintext ISO date). */
export const BACKUP_STAMP_PATH = "meta/chores/backup";

export const CHORE_CADENCE_DAYS = {
  gym: 3,
  csv: 7,
  /** The sync runs twice a week (Sunday + the midweek finance slot), so the
   *  longest gap kept on schedule is four days — "due" means a slot was missed,
   *  not that tomorrow's slot is coming. */
  vaultSync: 4,
  aperture: 7,
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
