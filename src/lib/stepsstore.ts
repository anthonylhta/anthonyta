import { readKey, writeKey, type StoreRead } from "./r2";

/**
 * stepsstore — the guarded R2 I/O for the daily step-count history (the TODAY-zone
 * steps row). Plaintext by design: a step count is low-sensitivity, so this is NOT
 * E2EE — it mirrors the reading index / TFT history (a plain JSON blob a single
 * writer read-modify-writes). Here the writer is the phone's daily push via
 * /api/daily/steps. No `R2_*` env (local dev, CI) → the store is off, the read
 * reports "error", and the write no-ops.
 */

export const STEPS_PATH = "meta/daily/steps.json";

/**
 * Read the raw step-history JSON, three-state. The distinction IS the point: the
 * ingest does a read-modify-write, so an "error" (store off / bad status / threw)
 * misread as "absent" would rebuild history from empty and clobber it. "absent" is
 * only ever a genuine first-run empty store.
 */
export async function getStepsRaw(): Promise<StoreRead<string>> {
  const read = await readKey(STEPS_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}

/**
 * Overwrite the step history. A single writer (the phone) means no conflict
 * handling is needed. `true` on success, `false` when the store is off or the
 * write fails; never surfaces the error.
 */
export async function putSteps(json: string): Promise<boolean> {
  const wrote = await writeKey(STEPS_PATH, json, {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}
