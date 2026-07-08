import { renderAppIcon } from "@/lib/pwa";

/**
 * The manifest's PNG icons, at stable URLs the manifest can hardcode (the file-
 * convention icon routes get hashed URLs, which a static manifest can't name).
 * Four specs — 192 and 512, each `any` and `maskable` — all from one renderer.
 * Prerendered at build via generateStaticParams, so they're static, cached PNGs.
 */
const SPECS: Record<string, { size: number; maskable: boolean }> = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  "maskable-192": { size: 192, maskable: true },
  "maskable-512": { size: 512, maskable: true },
};

export function generateStaticParams() {
  return Object.keys(SPECS).map((icon) => ({ icon }));
}

export const dynamicParams = false;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ icon: string }> },
) {
  const { icon } = await params;
  const spec = SPECS[icon];
  if (!spec) return new Response("Not found", { status: 404 });
  return renderAppIcon(spec.size, spec.maskable);
}
