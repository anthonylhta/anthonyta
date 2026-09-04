import { describe, expect, it } from "vitest";
import {
  AGENDA_CONTEXT,
  APERTURE_CONTEXT,
  APERTURE_HIST_PREFIX,
  apertureHistDay,
  apertureHistPath,
  FIN_CONTEXT,
  GU_MARKS_CONTEXT,
  GYM_CONTEXT,
  JOBS_CONTEXT,
  MEALS_CONTEXT,
  TODO_CONTEXT,
  TOTP_CONTEXT,
  TRANSIT_CONTEXT,
} from "./aevcontext";
import { AGENDA_PATH } from "./agendastore";
import { APERTURE_PATH } from "./aperturestore";
import { generateMk, open, seal, type EnvelopeMeta } from "./crypto";
import { FIN_PATH } from "./finstore";
import { GU_MARKS_PATH } from "./gumarksstore";
import { GYM_PATH } from "./gymstore";
import { JOBS_PATH } from "./jobsstore";
import { MEALS_PATH } from "./mealsstore";
import { TODO_PATH } from "./todostore";
import { TOTP_PATH } from "./totpstore";
import { TRANSIT_PATH } from "./transitstore";

const STORES = [
  { name: "fin", ctx: FIN_CONTEXT, path: FIN_PATH },
  { name: "transit", ctx: TRANSIT_CONTEXT, path: TRANSIT_PATH },
  { name: "todo", ctx: TODO_CONTEXT, path: TODO_PATH },
  { name: "totp", ctx: TOTP_CONTEXT, path: TOTP_PATH },
  { name: "gym", ctx: GYM_CONTEXT, path: GYM_PATH },
  { name: "meals", ctx: MEALS_CONTEXT, path: MEALS_PATH },
  { name: "agenda", ctx: AGENDA_CONTEXT, path: AGENDA_PATH },
  { name: "jobs", ctx: JOBS_CONTEXT, path: JOBS_PATH },
  { name: "gu-marks", ctx: GU_MARKS_CONTEXT, path: GU_MARKS_PATH },
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

  it("every context is distinct", () => {
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

describe("aevcontext — aperture", () => {
  it("equals the R2 path its store module reads from", () => {
    // The same drift guard the STORES array gives the fixed config stores, now
    // that aperturestore exists to pin against: seal and open using different
    // strings means a blob that stops decrypting on prod, so the context is held
    // equal to the PATH constant rather than to a literal copied beside it.
    expect(APERTURE_CONTEXT).toBe(APERTURE_PATH);
  });

  it("differs from every config-store context", () => {
    for (const s of STORES) expect(APERTURE_CONTEXT).not.toBe(s.ctx);
  });

  it("seals and opens under its own context, and only that one", async () => {
    const mk = await generateMk();
    const env = await seal(mk, meta, bytes, APERTURE_CONTEXT);
    const { bytes: out } = await open(mk, env, APERTURE_CONTEXT);
    expect(new TextDecoder().decode(out)).toBe("abc");
    await expect(open(mk, env, FIN_CONTEXT)).rejects.toThrow();
    await expect(open(mk, env)).rejects.toThrow();
  });
});

describe("aevcontext — aperture history family", () => {
  it("builds the dated key and reads the day back out of it", () => {
    expect(apertureHistPath("2026-07-26")).toBe(
      "meta/aperture-hist/2026-07-26.bin",
    );
    expect(apertureHistDay("meta/aperture-hist/2026-07-26.bin")).toBe(
      "2026-07-26",
    );
    expect(
      apertureHistPath("2026-07-26").startsWith(APERTURE_HIST_PREFIX),
    ).toBe(true);
  });

  it("refuses everything that is not a well-formed dated member", () => {
    for (const key of [
      "meta/aperture", // the live envelope, not the family
      "meta/aperture-hist/2026-07-26", // no extension
      "meta/aperture-hist/2026-07-26.json", // wrong extension
      "meta/aperture-hist/26-07-26.bin", // two-digit year
      "meta/aperture-hist/2026-7-26.bin", // unpadded month
      "meta/aperture-hist/latest.bin", // not a day at all
      "meta/aperture-hist/2026-07-26/x.bin", // nested
      "meta/aperture-hist/2026-07-26.bin.bak", // trailing junk
    ])
      expect(apertureHistDay(key), key).toBeNull();
  });

  it("the family prefix stays outside the live envelope's key", () => {
    // `meta/aperture` and `meta/aperture-hist/...` must never prefix-collide:
    // listings, backups and the rotation walk all bucket by prefix.
    expect(APERTURE_CONTEXT.startsWith(APERTURE_HIST_PREFIX)).toBe(false);
  });

  it("two days in the family cannot be swapped for each other", async () => {
    // The per-key AAD is the whole point: a compromised store must not be able
    // to answer a request for one week's seal with another week's bytes.
    const mk = await generateMk();
    const env = await seal(mk, meta, bytes, apertureHistPath("2026-07-26"));
    const { bytes: out } = await open(mk, env, apertureHistPath("2026-07-26"));
    expect(new TextDecoder().decode(out)).toBe("abc");
    await expect(
      open(mk, env, apertureHistPath("2026-08-02")),
    ).rejects.toThrow();
    await expect(open(mk, env, APERTURE_CONTEXT)).rejects.toThrow();
    await expect(open(mk, env)).rejects.toThrow();
  });
});
