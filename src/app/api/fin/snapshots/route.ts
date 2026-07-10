import { auth } from "@/auth";
import { readSnapshots } from "@/lib/finstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 366;

/**
 * Owner-gated read of the sealed daily snapshot boxes (ADR: sealed net worth) — each
 * box is encrypted to the owner's snapkey, so this only ever ships ciphertext the
 * client reopens with the passphrase; guests get the 404 wall (ADR 0022). `days`
 * (default 30) is clamped to [1, 366]; a non-numeric value falls back to the default.
 * A store error answers 503 — the client must never mistake a flake for empty history
 * — while an EMPTY `days` array is a healthy 200 (a brand-new vault simply has no
 * boxes yet).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const raw = new URL(request.url).searchParams.get("days");
    const parsed = parseInt(raw ?? "", 10);
    const days = Number.isNaN(parsed)
      ? DEFAULT_DAYS
      : Math.min(MAX_DAYS, Math.max(MIN_DAYS, parsed));

    const snaps = await readSnapshots(days);
    if (snaps.state === "error")
      return new Response("Unavailable", { status: 503 });

    return Response.json(
      { days: snaps.days },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[fin/snapshots] get failed", err);
    return nf();
  }
}
