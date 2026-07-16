import { auth } from "@/auth";
import { findPlaces } from "@/lib/connectors/transit";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated place autocomplete — relays free text to the TfNSW stop finder
 * with the server-side API key. Guests get the 404 wall (ADR 0022); the query
 * is used transiently and never stored. Short queries answer empty rather
 * than spending an upstream call per keystroke.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2)
    return Response.json(
      { sample: false, places: [] },
      { headers: { "cache-control": "no-store" } },
    );

  const read = await findPlaces(q);
  if (!read) return new Response("Unavailable", { status: 503 });
  return Response.json(read, { headers: { "cache-control": "no-store" } });
}
