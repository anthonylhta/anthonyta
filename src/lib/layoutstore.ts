import { readKey, writeKey, type StoreRead } from "./r2";

/**
 * layoutstore — R2 I/O for the owner's layout config (roadmap 59). One fixed
 * path, plaintext JSON both ways (see lib/layout.ts for why this store is
 * deliberately not E2EE). Single writer (the /system panel), rebuildable in
 * seconds from the panel — so overwrite is unconditional and there's no
 * no-clobber ceremony here, unlike the envelopes.
 */

export const LAYOUT_PATH = "meta/layout.json";

export type { StoreRead };

/** Read the raw config JSON; absent only on a healthy first run. */
export async function getLayoutRaw(): Promise<StoreRead<string>> {
  const read = await readKey(LAYOUT_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}

/** Overwrite the config. `true` on success; never surfaces the error. */
export async function putLayoutRaw(json: string): Promise<boolean> {
  const wrote = await writeKey(LAYOUT_PATH, json, {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}
