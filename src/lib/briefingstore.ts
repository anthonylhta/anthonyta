import { isBriefing } from "./briefing";
import { readKey, writeKey, type StoreRead } from "./r2";
import type { Briefing } from "./sampleBriefing";

/**
 * briefingstore — the guarded R2 I/O layer for the daily briefing (roadmap item 35
 * Phase A). Like every store module (finstore / dropstore) it degrades rather than
 * throws: no `R2_*` env (local dev, CI) → the store is off, the read reports "error",
 * and the write no-ops. Owns the single fixed key `meta/briefing/latest.json` — the
 * pipeline is the sole writer, so writes overwrite and no conflict handling is needed.
 *
 * The absent≠error discipline is kept here for consistency with the other stores even
 * though this record is low-stakes (a briefing miss just falls back to the sample /
 * Drive): a corrupt or unparseable blob is "error", never "absent", so nothing downstream
 * ever treats stored junk as "no briefing written yet".
 */

export const BRIEFING_PATH = "meta/briefing/latest.json";

/**
 * Read the stored briefing, three-state. "absent" is only ever a healthy read that found
 * nothing (the pipeline hasn't POSTed yet); a stored blob that won't parse or fails the
 * shape guard collapses to "error", never "absent".
 */
export async function getStoredBriefing(): Promise<StoreRead<Briefing>> {
  const read = await readKey(BRIEFING_PATH);
  if (read.state !== "ok") return read;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(read.value));
    if (!isBriefing(parsed)) return { state: "error" };
    return { state: "ok", value: parsed };
  } catch {
    return { state: "error" };
  }
}

/**
 * Overwrite the stored briefing (single writer — the pipeline — so no conflict handling).
 * `true` on success, `false` when the store is off or the write fails; never surfaces the
 * error. The caller validates the shape before writing.
 */
export async function putStoredBriefing(b: Briefing): Promise<boolean> {
  const wrote = await writeKey(BRIEFING_PATH, JSON.stringify(b), {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}
