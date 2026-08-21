import { readKey, writeKey, type StoreRead } from "./r2";

/**
 * sleepstore — the guarded R2 I/O for the nightly sleep history (the /aperture
 * vessel's rest figure). Plaintext by design, exactly as the step store is: a
 * night's duration is low-sensitivity, so this is NOT E2EE — it mirrors the
 * reading index / TFT history (a plain JSON blob a single writer
 * read-modify-writes). Here the writer is the phone's nightly push via
 * /api/daily/sleep. No `R2_*` env (local dev, CI) → the store is off, the read
 * reports "error", and the write no-ops.
 */

export const SLEEP_PATH = "meta/daily/sleep.json";

/**
 * Read the raw sleep-history JSON, three-state. The distinction IS the point: the
 * ingest does a read-modify-write, so an "error" (store off / bad status / threw)
 * misread as "absent" would rebuild history from empty and clobber it. "absent" is
 * only ever a genuine first-run empty store.
 */
export async function getSleepRaw(): Promise<StoreRead<string>> {
  const read = await readKey(SLEEP_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}

/**
 * Overwrite the sleep history. A single writer (the phone) means no conflict
 * handling is needed. `true` on success, `false` when the store is off or the
 * write fails; never surfaces the error.
 */
export async function putSleep(json: string): Promise<boolean> {
  const wrote = await writeKey(SLEEP_PATH, json, {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}
