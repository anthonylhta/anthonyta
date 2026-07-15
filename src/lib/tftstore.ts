import { readKey, writeKey, type StoreRead } from "./r2";

/**
 * tftstore — the guarded R2 I/O for the self-recorded TFT LP-history series (ADR
 * 0082). Plaintext by design: TFT ladder data is public, so this is NOT E2EE — it
 * mirrors the reading index (finstore): a plain JSON blob the nightly cron
 * read-modify-writes. No `R2_*` env (local dev, CI) → the store is off, the read
 * reports "error", and the write no-ops.
 */

export const TFT_HISTORY_PATH = "meta/tft/history.json";

/**
 * Read the raw LP-history JSON. The three-state IS THE POINT: the cron does a
 * read-modify-write, so an "error" (store off / bad status / threw) misread as
 * "absent" would rebuild it from empty and clobber the recorded history. "absent"
 * is only ever a genuine first-run empty store.
 */
export async function getTftHistoryRaw(): Promise<StoreRead<string>> {
  const read = await readKey(TFT_HISTORY_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}

/**
 * Overwrite the LP history (there is a single writer — the nightly cron — so no
 * conflict handling is needed). `true` on success, `false` when the store is off or
 * the write fails; never surfaces the error.
 */
export async function putTftHistory(json: string): Promise<boolean> {
  const wrote = await writeKey(TFT_HISTORY_PATH, json, {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}
