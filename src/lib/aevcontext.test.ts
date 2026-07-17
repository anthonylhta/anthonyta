import { describe, expect, it } from "vitest";
import {
  FIN_CONTEXT,
  TODO_CONTEXT,
  TOTP_CONTEXT,
  TRANSIT_CONTEXT,
} from "./aevcontext";
import { generateMk, open, seal, type EnvelopeMeta } from "./crypto";
import { FIN_PATH } from "./finstore";
import { TODO_PATH } from "./todostore";
import { TOTP_PATH } from "./totpstore";
import { TRANSIT_PATH } from "./transitstore";

const STORES = [
  { name: "fin", ctx: FIN_CONTEXT, path: FIN_PATH },
  { name: "transit", ctx: TRANSIT_CONTEXT, path: TRANSIT_PATH },
  { name: "todo", ctx: TODO_CONTEXT, path: TODO_PATH },
  { name: "totp", ctx: TOTP_CONTEXT, path: TOTP_PATH },
];

const meta: EnvelopeMeta = { n: "x.json", t: "application/json", s: 3 };
const bytes = new TextEncoder().encode("abc");

describe("aevcontext — drift guard", () => {
  it("each context equals the R2 path its store module writes to", () => {
    // The whole safety of threading rests on seal and open using the SAME string;
    // pinning each context to its store's own PATH constant makes a silent drift a
    // failing test, not a blob that stops decrypting on prod.
    for (const s of STORES) expect(s.ctx).toBe(s.path);
  });

  it("the four contexts are distinct", () => {
    expect(new Set(STORES.map((s) => s.ctx)).size).toBe(STORES.length);
  });
});

describe("aevcontext — AEV2 round-trip per store", () => {
  it("seals and opens under its own context", async () => {
    const mk = await generateMk();
    for (const s of STORES) {
      const env = await seal(mk, meta, bytes, s.ctx);
      const { bytes: out } = await open(mk, env, s.ctx);
      expect(new TextDecoder().decode(out)).toBe("abc");
    }
  });

  it("a v2 blob refuses to open with a WRONG context (like tampering)", async () => {
    const mk = await generateMk();
    const env = await seal(mk, meta, bytes, FIN_CONTEXT);
    await expect(open(mk, env, TRANSIT_CONTEXT)).rejects.toThrow();
  });

  it("a v2 blob refuses to open with NO context (programming error)", async () => {
    const mk = await generateMk();
    const env = await seal(mk, meta, bytes, TODO_CONTEXT);
    await expect(open(mk, env)).rejects.toThrow();
  });

  it("cross-store substitution fails: one store's blob won't open as another's", async () => {
    const mk = await generateMk();
    // A store swap under the same MK is exactly what AEV2 exists to stop.
    for (const s of STORES) {
      const env = await seal(mk, meta, bytes, s.ctx);
      for (const other of STORES) {
        if (other.ctx === s.ctx) continue;
        await expect(open(mk, env, other.ctx)).rejects.toThrow();
      }
    }
  });
});
