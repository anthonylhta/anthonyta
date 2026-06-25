import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Cron-secret gate — fail CLOSED. Vercel Cron sends `Authorization: Bearer
 * <CRON_SECRET>` when the secret is configured; we require a match.
 *
 * - Production with no `CRON_SECRET` set → REFUSE. (The old per-route check was
 *   `if (secret && …)`, which fell *open* if the env var was ever missing —
 *   leaving `/api/cron/snapshot`, a DB-writing endpoint, publicly triggerable.)
 * - Locally / in CI (no secret, not production) → allow, so the routes stay
 *   runnable by hand.
 *
 * The compare is constant-time (fixed-length SHA-256 digests + `timingSafeEqual`)
 * so the token can't be recovered byte-by-byte from response timing.
 *
 * Returns a 401 `Response` to short-circuit with, or `null` when the caller is
 * authorized.
 */
export function authorizeCron(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return new Response("Unauthorized", { status: 401 });
    }
    return null; // local / CI convenience — nothing to check against
  }
  const provided = req.headers.get("authorization") ?? "";
  if (!safeEqual(provided, `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

/** Constant-time string equality via fixed-length SHA-256 digests (length-blind). */
function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}
