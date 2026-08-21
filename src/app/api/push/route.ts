import { auth } from "@/auth";
import { randomId } from "@/lib/crypto";
import {
  addSub,
  EMPTY_PUSH_CONFIG,
  isPushSub,
  parsePushConfig,
  PUSH_CATEGORIES,
  PUSH_MAX_BYTES,
  removeSub,
  sanitizeConfig,
  serializePushConfig,
  setCategory,
  type PushCategory,
  type PushConfig,
} from "@/lib/push";
import { getPushRaw, putPush } from "@/lib/pushstore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated read/write of the Web Push subscription config. Guests get the
 * usual 404 wall (ADR 0022) on every verb — the hub must not admit that a
 * notification surface exists any more than it admits the owner mode does.
 *
 * GET hands back a SANITIZED view: ids, labels, created stamps and the category
 * toggles, never the endpoint or the two subscription keys. Those are the
 * credentials that let anyone holding them buzz the owner's phone; the panel has
 * no use for them, so they never leave the server.
 *
 * Absent folds to the all-on empty config (the layout store's ruling: one writer,
 * rebuilt in a tap, no re-seed hazard) but a store FLAKE stays 503 on reads and
 * refuses every write — all three mutations are read-modify-writes over the
 * device list, and an error read as "no devices" would unsubscribe the owner's
 * other phones on the next save.
 */

/** Read the config for a mutation. `null` = store flake; the caller must 503. */
async function loadForWrite(): Promise<PushConfig | null> {
  const read = await getPushRaw();
  if (read.state === "error") return null;
  if (read.state === "absent") return EMPTY_PUSH_CONFIG;
  return parsePushConfig(read.value);
}

async function save(cfg: PushConfig): Promise<Response> {
  if (!(await putPush(serializePushConfig(cfg)))) return nf();
  return Response.json(sanitizeConfig(cfg), {
    headers: { "cache-control": "no-store" },
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const read = await getPushRaw();
    if (read.state === "error")
      return new Response("Unavailable", { status: 503 });
    const cfg =
      read.state === "absent" ? EMPTY_PUSH_CONFIG : parsePushConfig(read.value);
    return Response.json(sanitizeConfig(cfg), {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[push] get failed", err);
    return nf();
  }
}

/** Enroll this device — the browser's `PushSubscription`, plus a cosmetic label. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const body = await request.text();
    if (body.length > PUSH_MAX_BYTES) return nf();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (typeof parsed !== "object" || parsed === null)
      return new Response("Bad request", { status: 400 });

    const { endpoint, keys, label } = parsed as Record<string, unknown>;
    // The id and the stamp are the server's to mint — a client-chosen id could
    // collide with (and so remove) another device.
    const sub = {
      id: randomId(),
      endpoint,
      keys,
      label: typeof label === "string" && label.length > 0 ? label : "device",
      created: new Date().toISOString(),
    };
    if (!isPushSub(sub)) return new Response("Bad request", { status: 400 });

    const cfg = await loadForWrite();
    if (!cfg) return new Response("Unavailable", { status: 503 });
    return await save(addSub(cfg, sub));
  } catch (err) {
    console.error("[push] post failed", err);
    return nf();
  }
}

/** Flip the category toggles — `{ categories: { dropbox: bool, … } }`. */
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const body = await request.text();
    if (body.length > PUSH_MAX_BYTES) return nf();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const categories =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>).categories
        : null;
    if (typeof categories !== "object" || categories === null)
      return new Response("Bad request", { status: 400 });

    let cfg = await loadForWrite();
    if (!cfg) return new Response("Unavailable", { status: 503 });
    const asked = categories as Record<string, unknown>;
    for (const category of PUSH_CATEGORIES) {
      const value = asked[category];
      if (typeof value === "boolean")
        cfg = setCategory(cfg, category as PushCategory, value);
    }
    return await save(cfg);
  } catch (err) {
    console.error("[push] put failed", err);
    return nf();
  }
}

/** Remove one device: `DELETE /api/push?id=…`. Idempotent — an unknown id saves
 *  the config unchanged rather than reporting on which ids exist. */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return new Response("Bad request", { status: 400 });

    const cfg = await loadForWrite();
    if (!cfg) return new Response("Unavailable", { status: 503 });
    return await save(removeSub(cfg, id));
  } catch (err) {
    console.error("[push] delete failed", err);
    return nf();
  }
}
