import { fromB64url, randomId } from "@/lib/crypto";
import { dropPath, MAX_ENVELOPE_BYTES } from "@/lib/dropbox";
import { putDrop } from "@/lib/dropstore";
import { POW_BITS, verify } from "@/lib/pow";

export const dynamic = "force-dynamic";

// Every rejection is a generic status with NO detail — a bot must not learn WHICH
// gate it tripped (size, proof-of-work, or rate), so there is no oracle to tune
// against. Success and the store being off are the only distinguishable outcomes.
const bad = () => new Response("Bad request", { status: 400 });
const rateLimited = () => new Response("Too many requests", { status: 429 });

/**
 * Best-effort, per-instance rate window. A serverless deployment may run several
 * instances and recycle them, so this Map is a coarse first line only — the
 * proof-of-work gate is the real cost imposed on bulk submission. Keyed by the
 * first `x-forwarded-for` hop; a spoofed header only lets an abuser rate-limit
 * themselves.
 */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const hits = new Map<string, number[]>();

function overRate(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_MAX;
}

/**
 * Public ingest for one sealed drop-box message (ADR: sealed box, resurrected). No
 * auth — a stranger is the expected caller. The body is `{ envelope_b64, nonce }`: the
 * envelope is ciphertext the server can never open, and `nonce` is the proof-of-work
 * solution bound to those exact bytes. Three gates, all generic on failure so a bot
 * learns nothing: an oversize envelope, a proof-of-work miss, or a tripped per-IP
 * window. On success the envelope lands at a fresh random `dropbox/<id>.bin`; a store
 * that's off answers a generic 503, never a crash.
 */
export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (overRate(ip)) return rateLimited();

  try {
    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== "object" || body === null) return bad();
    const { envelope_b64, nonce } = body as {
      envelope_b64?: unknown;
      nonce?: unknown;
    };
    if (typeof envelope_b64 !== "string" || typeof nonce !== "number")
      return bad();

    let envelope: Uint8Array;
    try {
      envelope = fromB64url(envelope_b64);
    } catch {
      return bad();
    }
    if (envelope.byteLength === 0 || envelope.byteLength > MAX_ENVELOPE_BYTES)
      return bad();

    // The proof-of-work is over the exact ciphertext, so a solution can't be
    // precomputed or replayed against a different message.
    if (!(await verify(envelope, nonce, POW_BITS))) return bad();

    const ok = await putDrop(dropPath(randomId()), envelope);
    // Store off / write failure — generic, no oracle, never a crash.
    if (!ok) return new Response("Unavailable", { status: 503 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[dropbox] ingest failed", err);
    return new Response("Unavailable", { status: 503 });
  }
}
