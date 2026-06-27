import { auth } from "@/auth";
import { getVaultImages } from "@/lib/connectors/vault";
import { driveToken } from "@/lib/google";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated image bytes for the vault reader (ADR 0048). The vault lives on Drive,
 * so an `![[image]]` embed renders as `<img src="/vault/img/<driveId>">` and this
 * route streams the file through the read-only service account. Guests get a 404 —
 * the same contract as the `/vault` pages (ADR 0022 / 0030 / 0045). Only ids the
 * vault index actually contains are served, so the route can't be coaxed into
 * proxying arbitrary Drive files.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return nf();

  const { id } = await params;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return nf();

  const image = (await getVaultImages()).find((im) => im.id === id);
  if (!image) return nf();

  const token = await driveToken();
  if (!token) return nf();

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok || !res.body) return nf();

  return new Response(res.body, {
    headers: {
      "content-type": image.mimeType,
      "cache-control": "private, max-age=3600",
    },
  });
}
