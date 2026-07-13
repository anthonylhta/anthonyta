import { auth } from "@/auth";
import {
  isWebauthnRecord,
  removeCred,
  type WebauthnRecord,
} from "@/lib/webauthn/record";
import { getWebauthnRecord, putWebauthnRecord } from "@/lib/webauthn/store";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });
const unavailable = () => new Response("Unavailable", { status: 503 });

// Credential ids cap at 200 chars in the record; a body carrying just `{ id }`
// never approaches this — anything bigger is junk, dropped as a 404.
const MAX_BODY_BYTES = 512;

/**
 * Owner-gated sign-in passkey inventory (roadmap item 37 b/c) — the management
 * face of the same `meta/webauthn` record the door reads. GET lists the enrolled
 * credentials SANITIZED (never the public keys), DELETE revokes one by id.
 *
 * Guests get the 404 wall like every owner route (ADR 0022): an unauthenticated
 * request is indistinguishable from a missing route. The absent≠error contract
 * carries the keystore lesson — an absent record is an empty inventory, a store
 * hiccup is a 503, so a flake never masquerades as "nothing enrolled".
 */

/** The client-facing projection: no `pk` (public keys are useless to the UI and
 *  shipping them would be gratuitous), just what the manager renders. */
export interface CredView {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  counter: number;
}

type RecordRead =
  | { state: "ok"; record: WebauthnRecord }
  | { state: "absent" }
  | { state: "error" };

/** Read + parse + shape-check the record, collapsing malformed bytes to "error"
 *  (never "absent"), the same discipline the sibling enrollment routes use. */
async function readRecord(): Promise<RecordRead> {
  const read = await getWebauthnRecord();
  if (read.state === "absent") return { state: "absent" };
  if (read.state !== "ok") return { state: "error" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.value);
  } catch {
    return { state: "error" };
  }
  if (!isWebauthnRecord(parsed)) return { state: "error" };
  return { state: "ok", record: parsed };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  const read = await readRecord();
  if (read.state === "absent")
    return Response.json(
      { creds: [] },
      { headers: { "cache-control": "no-store" } },
    );
  if (read.state === "error") return unavailable();

  const creds: CredView[] = read.record.creds.map((c) => ({
    id: c.id,
    label: c.label,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
    counter: c.counter,
  }));
  return Response.json({ creds }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return nf();
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return nf();
    const { id } = parsed as { id?: unknown };
    if (typeof id !== "string" || id.length === 0 || id.length > 200)
      return nf();

    const read = await readRecord();
    if (read.state === "absent") return nf(); // nothing enrolled → unknown id
    if (read.state === "error") return unavailable();

    const next = removeCred(read.record, id);
    if (!next) {
      // null is two cases: an unknown id (404, like a missing route) or the
      // deliberate refusal to strip the last passkey while no recovery code
      // exists (409) — the "kept, you'd lock yourself out" signal for the UI.
      const known = read.record.creds.some((c) => c.id === id);
      return known ? new Response("Conflict", { status: 409 }) : nf();
    }

    const wrote = await putWebauthnRecord(JSON.stringify(next), true);
    if (wrote !== "ok") return unavailable();
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[webauthn] creds delete failed", err);
    return nf();
  }
}
