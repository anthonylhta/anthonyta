import { readKey, writeKey, type StoreRead } from "./r2";

/**
 * nowstore — R2 I/O for the front door's "now" block. One fixed path, plaintext
 * JSON both ways: these are the words the public lobby prints to strangers (see
 * lib/now), so there is nothing here to seal — the steps history's precedent,
 * for the same reason. Single writer (the /system panel and the ⌘K verb, both
 * the owner's), rebuildable in a minute from the panel, so the overwrite is
 * unconditional and there is no no-clobber ceremony here.
 */

export const NOW_PATH = "meta/now.json";

export type { StoreRead };

/** Read the raw block JSON; absent only on a healthy first run. */
export async function getNowRaw(): Promise<StoreRead<string>> {
  const read = await readKey(NOW_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}

/** Overwrite the block. `true` on success; never surfaces the error. */
export async function putNowRaw(json: string): Promise<boolean> {
  const wrote = await writeKey(NOW_PATH, json, {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}
