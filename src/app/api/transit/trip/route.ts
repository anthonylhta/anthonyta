import { auth } from "@/auth";
import { planTrip } from "@/lib/connectors/transit";
import { isModeFilter, parseEndpointParam } from "@/lib/transit";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated journey planning — relays one origin→destination request to the
 * TfNSW trip endpoint with the server-side API key and returns normalized
 * journeys (legs, real-time delays, cancellations, alerts). Guests get the
 * 404 wall (ADR 0022). The endpoints arrive per-request from the client's
 * decrypted config and are never stored — the server holds an address only
 * for the lifetime of the upstream call.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  const params = new URL(request.url).searchParams;
  const from = parseEndpointParam(params.get("from"));
  const to = parseEndpointParam(params.get("to"));
  const modes = params.get("modes") ?? "all";
  if (!from || !to || !isModeFilter(modes))
    return new Response("Bad request", { status: 400 });

  const read = await planTrip({ from, to, modes });
  if (!read) return new Response("Unavailable", { status: 503 });
  return Response.json(read, { headers: { "cache-control": "no-store" } });
}
