import { get, put } from "@vercel/blob";
import type { StoreRead, StoreWrite } from "@/lib/finstore";
import { WEBAUTHN_PATH } from "./record";

/**
 * Guarded blob I/O for the passkey credential record — `meta/webauthn` in the
 * same private store, the getSnapkey/putSnapkey pattern verbatim. Degrades
 * rather than throws: no BLOB_READ_WRITE_TOKEN → reads report "error" and the
 * door simply can't authenticate; it never crashes a page.
 *
 * Three-state reads are load-bearing here too: "absent" is what arms the
 * bootstrap paths (first enrollment mints the recovery code; the break-glass
 * flag only honors a strictly-absent record), so an "error" misread as
 * "absent" could invite a second first-enrollment. `useCache: false` because
 * enrollment and counter updates read-modify-write this record across
 * requests — a CDN-stale read would resurrect a consumed recovery code.
 */
export function webauthnStoreEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function getWebauthnRecord(): Promise<StoreRead<string>> {
  if (!webauthnStoreEnabled()) return { state: "error" };
  try {
    const res = await get(WEBAUTHN_PATH, {
      access: "private",
      useCache: false,
    });
    if (!res) return { state: "absent" };
    if (res.statusCode !== 200) return { state: "error" };
    return { state: "ok", value: await new Response(res.stream).text() };
  } catch (err) {
    console.error("[webauthn] record read failed:", err);
    return { state: "error" };
  }
}

/**
 * Write the record at its fixed path. First enrollment writes with `overwrite`
 * false so a raced or replayed bootstrap physically cannot clobber an existing
 * record (the throw path re-checks existence to report "conflict"); routine
 * mutations — appending a credential, advancing a counter, consuming the
 * recovery code — pass true. The caller validates the shape; this moves bytes.
 */
export async function putWebauthnRecord(
  json: string,
  overwrite: boolean,
): Promise<StoreWrite> {
  if (!webauthnStoreEnabled()) return "failed";
  try {
    await put(WEBAUTHN_PATH, json, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: overwrite,
      contentType: "application/json",
    });
    return "ok";
  } catch (err) {
    if (!overwrite && (await getWebauthnRecord()).state === "ok")
      return "conflict";
    console.error("[webauthn] record write failed:", err);
    return "failed";
  }
}
