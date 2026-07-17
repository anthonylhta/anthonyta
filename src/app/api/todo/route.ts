import { auth } from "@/auth";
import { MAGIC } from "@/lib/crypto";
import { TODO_MAX_BYTES } from "@/lib/todo";
import { getTodoConfig, putTodoConfig } from "@/lib/todostore";

export const dynamic = "force-dynamic";

const nf = () => new Response("Not found", { status: 404 });

/**
 * Owner-gated storage for the E2EE quick-capture envelope (roadmap 53) — the
 * todo list, sealed under the vault master key so the server only ever holds
 * ciphertext (the fin/transit/totp pattern). Guests get the 404 wall (ADR
 * 0022). Past the gate, absent and error stay distinguishable: a missing
 * envelope is first-run (404) while a store flake is 503 — a flake read as
 * "no list yet" would lure a re-seed that clobbers the owner's captures. PUT
 * sanity-checks only the envelope FRAME (size + magic) and refuses to
 * overwrite without an explicit `x-todo-overwrite: 1`.
 */

const MAGIC_BYTES = new TextEncoder().encode(MAGIC);
// 4 magic + 12 IV + 16 GCM tag + at least 1 ciphertext byte.
const MIN_ENVELOPE_BYTES = MAGIC_BYTES.length + 12 + 16 + 1;

export async function GET() {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const cfg = await getTodoConfig();
    if (cfg.state === "error")
      return new Response("Unavailable", { status: 503 });
    if (cfg.state === "absent") return nf();

    return new Response(cfg.value as BodyInit, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[todo] get failed", err);
    return nf();
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user) return nf();

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());

    // Frame sanity only — the server can't (and must never) decrypt.
    if (bytes.byteLength > TODO_MAX_BYTES) return nf();
    if (bytes.byteLength < MIN_ENVELOPE_BYTES) return nf();
    for (let i = 0; i < MAGIC_BYTES.length; i++) {
      if (bytes[i] !== MAGIC_BYTES[i]) return nf();
    }

    const overwrite = request.headers.get("x-todo-overwrite") === "1";
    const result = await putTodoConfig(bytes, overwrite);
    if (result === "conflict") return new Response("Conflict", { status: 409 });
    return result === "ok" ? Response.json({ ok: true }) : nf();
  } catch (err) {
    console.error("[todo] put failed", err);
    return nf();
  }
}
