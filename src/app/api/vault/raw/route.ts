import { auth } from "@/auth";
import { isValidVaultPath } from "@/lib/vaultblob";
import { readVaultStream } from "@/lib/vaultstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated same-origin ciphertext proxy for one vault blob (ADR: E2EE vault). The
 * client decrypts the envelope in-browser, and a presigned blob URL can't be assumed
 * CORS-readable from JS — so the bytes proxy through here instead. That costs zero
 * privacy: what transits this function is ciphertext the server already stores. Kept
 * separate from the inbox raw route so each domain's guard independently guarantees
 * "raw can never exfiltrate the keystore": `isValidVaultPath`'s `vault/` prefix
 * requirement structurally bars `meta/keystore`, the inbox, and traversal probes, and
 * every failure is a 404 — the vault contract (ADR 0022).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  const p = new URL(request.url).searchParams.get("p");
  if (!p || !isValidVaultPath(p)) return nf();

  const stream = await readVaultStream(p);
  if (!stream) return nf();

  return new Response(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}
