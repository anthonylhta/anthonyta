import { AwsClient } from "aws4fetch";

/**
 * r2 — the one low-level Cloudflare R2 client layer every store module shares
 * (ADR 0060). R2 speaks the S3 API; requests are SigV4-signed with `aws4fetch`
 * (small enough to audit, fetch-based, and the presigned-URL path is first-class)
 * rather than the full AWS SDK tree. Path-style URLs against the account endpoint:
 * `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`.
 *
 * Two altitudes live here:
 *  - transport (`r2Get`/`r2Put`/`r2Delete`/`r2List`/presign): thin signed fetches
 *    that THROW on transport failure — callers own their guarding;
 *  - the guarded byte-movers (`readKey`/`writeKey`) the fixed-path stores
 *    (keystore, fin, snapkey, webauthn record) wrap one-line contracts around.
 *
 * `readKey` keeps "absent" strictly apart from "error" because the distinction is
 * load-bearing everywhere it's used (ADR 0053/0054): absent arms first-run setup
 * paths that mint FRESH keys, so a transient failure misread as absence could
 * orphan every encrypted item. A 404 counts as absent only when R2 says
 * `NoSuchKey` — a 404 for a misconfigured bucket (`NoSuchBucket`) stays an error.
 *
 * `writeKey` keeps the no-clobber contract atomic: a first-run write sends
 * `If-None-Match: *` (R2 implements conditional PutObject), so an existing object
 * refuses the write with a 412 → "conflict" — a client that misread a flaky fetch
 * as "no key yet" physically cannot overwrite the real one.
 */

export type StoreRead<T> =
  | { state: "ok"; value: T }
  | { state: "absent" }
  | { state: "error" };
export type StoreWrite = "ok" | "conflict" | "failed";

export interface R2ListedObject {
  key: string;
  size: number;
  /** ISO-8601 upload time, as ListObjectsV2 reports it. */
  lastModified: string;
}

export interface R2ListPage {
  objects: R2ListedObject[];
  /** Continuation token for the next page; unset on the last one. */
  next?: string;
}

// 3 attempts total (~150ms worst-case backoff): fail fast so a degraded store
// falls back to its guarded placeholder instead of pinning a request open.
const RETRIES = 2;

interface R2Env {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function env(): R2Env | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

/** The store is only reachable when all four `R2_*` env vars are configured. */
export function r2Enabled(): boolean {
  return env() !== null;
}

/**
 * The S3-endpoint origin, for the CSP: presigned browser PUTs (connect-src) and
 * the legacy-thumbnail 302 targets (img-src) both land on it. `null` when the
 * store is off so the policy can omit it entirely.
 */
export function r2Origin(): string | null {
  const e = env();
  return e ? `https://${e.accountId}.r2.cloudflarestorage.com` : null;
}

function required(): R2Env {
  const e = env();
  if (!e) throw new Error("R2 store is not configured (set the R2_* env vars)");
  return e;
}

function client(e: R2Env): AwsClient {
  return new AwsClient({
    accessKeyId: e.accessKeyId,
    secretAccessKey: e.secretAccessKey,
    service: "s3",
    region: "auto",
    retries: RETRIES,
  });
}

/** Path-style object URL. Keys here are machine-generated (`[A-Za-z0-9._/-]`),
 *  but each segment is percent-encoded anyway so a stray byte can't bend the path. */
function objectUrl(e: R2Env, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `https://${e.accountId}.r2.cloudflarestorage.com/${e.bucket}/${encoded}`;
}

/** Signed GET for one object; the caller interprets the status (404 body says
 *  whether the KEY or the BUCKET is missing — see `readKey`). */
export async function r2Get(key: string): Promise<Response> {
  const e = required();
  return client(e).fetch(objectUrl(e, key));
}

/**
 * Signed PUT of one object. `ifNoneMatch` sends `If-None-Match: *`, making the
 * write conditional on the key NOT existing — R2 answers 412 instead of
 * overwriting. A retried PUT re-sends the same bytes, so the transport-level
 * retry on 5xx stays idempotent.
 *
 * Signs first, then ships the RAW body through a plain fetch: `AwsClient.fetch`
 * threads the body through the signed Request, which Node's fetch can send as a
 * length-less stream (chunked) — R2 refuses that with 411 Length-Required. A
 * bare string/Uint8Array body lets undici measure it and set Content-Length;
 * the signature stays valid because aws4fetch signs the payload as
 * UNSIGNED-PAYLOAD and Content-Length is not part of the signature.
 */
export async function r2Put(
  key: string,
  body: Uint8Array | string,
  opts: { contentType: string; ifNoneMatch?: boolean },
): Promise<Response> {
  const e = required();
  const headers: Record<string, string> = { "content-type": opts.contentType };
  if (opts.ifNoneMatch) headers["if-none-match"] = "*";
  const signed = await client(e).sign(objectUrl(e, key), {
    method: "PUT",
    body: body as BodyInit,
    headers,
  });
  // sign() doesn't transport, so mirror AwsClient's retry-on-5xx/429 backoff.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body: body as BodyInit,
    });
    if ((res.status < 500 && res.status !== 429) || attempt === RETRIES)
      return res;
    await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
  }
}

/** Signed DELETE for one object (S3 deletes are idempotent — a missing key 204s). */
export async function r2Delete(key: string): Promise<Response> {
  const e = required();
  return client(e).fetch(objectUrl(e, key), { method: "DELETE" });
}

/**
 * One ListObjectsV2 page under `prefix`. Throws on a non-2xx — callers treat a
 * failed list as "don't touch anything" (a silently-empty page would read as an
 * empty store and, for the cron's read-modify-write, clobber history).
 */
export async function r2List(
  prefix: string,
  token?: string,
): Promise<R2ListPage> {
  const e = required();
  const url = new URL(
    `https://${e.accountId}.r2.cloudflarestorage.com/${e.bucket}/`,
  );
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", prefix);
  if (token) url.searchParams.set("continuation-token", token);
  const res = await client(e).fetch(url.toString());
  if (!res.ok) throw new Error(`r2 list failed: HTTP ${res.status}`);
  return parseListXml(await res.text());
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function decodeXml(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m]);
}

/** First `<name>…</name>` text in `block`, or null. Fields in a ListObjectsV2
 *  response never nest, so "up to the next `<`" is the whole value. */
function tagText(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1] : null;
}

/**
 * Parse a ListObjectsV2 XML body. Exported for tests. Machine-generated XML over
 * machine-generated keys — every key this app writes matches `[A-Za-z0-9._/-]` —
 * so a scoped regex walk is sufficient; entities are decoded anyway for safety.
 */
export function parseListXml(xml: string): R2ListPage {
  const objects: R2ListedObject[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1];
    const key = tagText(block, "Key");
    if (key === null) continue;
    objects.push({
      key: decodeXml(key),
      size: Number(tagText(block, "Size") ?? "0"),
      lastModified: tagText(block, "LastModified") ?? "",
    });
  }
  const token =
    tagText(xml, "IsTruncated") === "true"
      ? tagText(xml, "NextContinuationToken")
      : null;
  return token === null ? { objects } : { objects, next: decodeXml(token) };
}

/**
 * Mint a presigned URL, good for `ttlSeconds`. Query-signed (SigV4), so only
 * `host` is bound into the signature — the browser is free to send its own
 * headers with the eventual request. Validity is checked when R2 RECEIVES the
 * request, so a slow upload that started inside the window completes fine.
 */
async function presign(
  method: "GET" | "PUT",
  key: string,
  ttlSeconds: number,
): Promise<string> {
  const e = required();
  const url = new URL(objectUrl(e, key));
  url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
  const signed = await client(e).sign(url.toString(), {
    method,
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Presigned download URL for one object (the dl route's 302 target). */
export function r2PresignGet(key: string, ttlSeconds: number): Promise<string> {
  return presign("GET", key, ttlSeconds);
}

/** Presigned upload URL for one object (the browser-direct upload path). */
export function r2PresignPut(key: string, ttlSeconds: number): Promise<string> {
  return presign("PUT", key, ttlSeconds);
}

/**
 * Read one fixed-path object's bytes, three-state. "absent" is only ever a
 * healthy read that R2 answered `NoSuchKey` for — first run, nothing written
 * yet. Everything else (store off, transport throw, bad status, a 404 whose
 * body says the BUCKET is missing) is "error": the callers' setup paths key off
 * absence to mint fresh keys, so an error misread as absence loses data.
 */
export async function readKey(key: string): Promise<StoreRead<Uint8Array>> {
  if (!r2Enabled()) return { state: "error" };
  try {
    const res = await r2Get(key);
    if (res.status === 404) {
      if ((await res.text()).includes("NoSuchKey")) return { state: "absent" };
      console.error(
        "[r2] read 404 without NoSuchKey (bucket misconfig?):",
        key,
      );
      return { state: "error" };
    }
    if (!res.ok) return { state: "error" };
    return { state: "ok", value: new Uint8Array(await res.arrayBuffer()) };
  } catch (err) {
    console.error("[r2] read failed:", key, err);
    return { state: "error" };
  }
}

/**
 * Write one fixed-path object. `overwrite: false` (first-run setup) makes the
 * PUT conditional (`If-None-Match: *`) so an existing object refuses it — 412 →
 * "conflict". Any other refusal on a no-clobber write re-checks existence and
 * still reports "conflict" when the object is there (belt and braces, mirroring
 * the pre-R2 stores). The caller validates content; this only moves bytes.
 */
export async function writeKey(
  key: string,
  body: Uint8Array | string,
  opts: { overwrite: boolean; contentType: string },
): Promise<StoreWrite> {
  if (!r2Enabled()) return "failed";
  try {
    const res = await r2Put(key, body, {
      contentType: opts.contentType,
      ifNoneMatch: !opts.overwrite,
    });
    if (res.ok) return "ok";
    if (!opts.overwrite) {
      if (res.status === 412) return "conflict";
      if ((await readKey(key)).state === "ok") return "conflict";
    }
    console.error("[r2] write failed:", key, `HTTP ${res.status}`);
    return "failed";
  } catch (err) {
    console.error("[r2] write failed:", key, err);
    return "failed";
  }
}
