import { readKey, writeKey, type StoreRead } from "./r2";

/**
 * pushstore — R2 I/O for the Web Push subscription config. One fixed path,
 * plaintext JSON both ways (see lib/push.ts for why this store cannot be
 * sealed: the server is the sender, so it must hold the endpoint in the clear).
 * Conceptually a single writer — the /system panel, plus the nightly cron
 * stamping the ingest episode markers — so overwrite is unconditional and there
 * is no no-clobber ceremony here, unlike the envelopes.
 */

export const PUSH_PATH = "meta/push.json";

export type { StoreRead };

/** Read the raw config JSON, three-state. `absent` is a genuine first run (nobody
 *  has enabled push on a device yet); `error` is the store being off or flaky,
 *  and the callers that read-modify-write MUST NOT confuse the two — folding an
 *  error into "no devices" would drop every other device on the next write. */
export async function getPushRaw(): Promise<StoreRead<string>> {
  const read = await readKey(PUSH_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}

/** Overwrite the config. `true` on success; never surfaces the error. */
export async function putPush(json: string): Promise<boolean> {
  const wrote = await writeKey(PUSH_PATH, json, {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}
