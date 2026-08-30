import { describe, expect, it } from "vitest";
import {
  AGENDA_CONTEXT,
  APERTURE_CONTEXT,
  apertureHistPath,
  FIN_CONTEXT,
  GYM_CONTEXT,
  MEALS_CONTEXT,
  TODO_CONTEXT,
  TOTP_CONTEXT,
  TRANSIT_CONTEXT,
} from "./aevcontext";
import { generateMk, open, seal } from "./crypto";
import { plainOutPath, planRow } from "./decrypt";
import { DROPBOX_KEY_PATH } from "./dropbox";
import { LAYOUT_PATH } from "./layoutstore";
import { VAULT_MANIFEST_PATH } from "./vaultblob";

const ID = "aBcDeFgHiJkLmNoPqRsTuV"; // a 22-char base64url blob id

describe("plainOutPath", () => {
  it("turns the key into a directory, stripping ONE trailing .bin", () => {
    expect(plainOutPath(`vault/n-${ID}.bin`, "2026-08-01.md")).toBe(
      `vault/n-${ID}/2026-08-01.md`,
    );
    // Only the last one: a name that genuinely ends in .bin keeps its own suffix.
    expect(plainOutPath("vault/thing.bin.bin", "thing.bin")).toBe(
      "vault/thing.bin/thing.bin",
    );
  });

  it("keeps a key that has no .bin suffix", () => {
    expect(plainOutPath("meta/fin", "fin.json")).toBe("meta/fin/fin.json");
  });

  it("falls back to `payload` for a name with a separator", () => {
    expect(plainOutPath(`vault/n-${ID}.bin`, "journal/2026-08-01.md")).toBe(
      `vault/n-${ID}/payload`,
    );
    expect(plainOutPath("inbox/e-x.bin", "a\\b.txt")).toBe("inbox/e-x/payload");
  });

  it("falls back to `payload` for traversal names", () => {
    expect(plainOutPath("meta/fin", "..")).toBe("meta/fin/payload");
    expect(plainOutPath("meta/fin", ".")).toBe("meta/fin/payload");
  });

  it("falls back to `payload` for an empty or over-long name", () => {
    expect(plainOutPath("meta/fin", "")).toBe("meta/fin/payload");
    expect(plainOutPath("meta/fin", "a".repeat(121))).toBe("meta/fin/payload");
    expect(plainOutPath("meta/fin", "a".repeat(120))).toBe(
      `meta/fin/${"a".repeat(120)}`,
    );
  });

  it("keeps the spaces and dots a real filename carries", () => {
    expect(plainOutPath("inbox/e-x.bin", "holiday photo v2.1.jpg")).toBe(
      "inbox/e-x/holiday photo v2.1.jpg",
    );
  });
});

describe("planRow", () => {
  it("opens a vault note with no context (AEV1)", () => {
    expect(planRow(`vault/n-${ID}.bin`)).toEqual({ action: "decrypt" });
    expect(planRow(`vault/i-${ID}.bin`)).toEqual({ action: "decrypt" });
    expect(planRow("vault/index")).toEqual({ action: "decrypt" });
  });

  it("names the vault integrity manifest apart", () => {
    expect(planRow(VAULT_MANIFEST_PATH)).toEqual({
      action: "decrypt-manifest",
    });
  });

  it("opens an encrypted inbox row, copies a legacy plaintext one", () => {
    expect(planRow(`inbox/e-${ID}.bin`)).toEqual({ action: "decrypt" });
    const legacy = planRow("inbox/holiday.jpg");
    expect(legacy.action).toBe("copy");
    if (legacy.action === "copy") expect(legacy.reason).toContain("plaintext");
  });

  it("carries each fixed store's AAD path as the open context", () => {
    for (const ctx of [
      FIN_CONTEXT,
      TRANSIT_CONTEXT,
      TODO_CONTEXT,
      TOTP_CONTEXT,
      GYM_CONTEXT,
      MEALS_CONTEXT,
      AGENDA_CONTEXT,
      APERTURE_CONTEXT,
    ]) {
      expect(planRow(ctx)).toEqual({ action: "decrypt", context: ctx });
    }
  });

  it("binds an archived seal to its OWN dated key", () => {
    const key = apertureHistPath("2026-08-01");
    expect(planRow(key)).toEqual({ action: "decrypt", context: key });
  });

  it("passes the dropbox key record through sealed", () => {
    expect(planRow(DROPBOX_KEY_PATH)).toEqual({ action: "sealed" });
  });

  it("copies plaintext-by-design hub state, recording the reason", () => {
    const row = planRow(LAYOUT_PATH);
    expect(row.action).toBe("copy");
    if (row.action === "copy") expect(row.reason.length).toBeGreaterThan(0);
  });

  it("leaves an unclassified key alone", () => {
    expect(planRow("meta/snapkey")).toEqual({ action: "unclassified" });
    expect(planRow("vault/n-short.bin")).toEqual({ action: "unclassified" });
  });
});

describe("planRow — round trip", () => {
  it("the context it hands back opens a real AEV2 envelope", async () => {
    // The whole point of carrying the context: seal exactly as the store does,
    // then open with nothing but the key the manifest recorded.
    const mk = await generateMk();
    const body = new TextEncoder().encode(JSON.stringify({ v: 2, cash: 1 }));
    const envelope = await seal(
      mk,
      { n: "fin.json", t: "application/json", s: body.length },
      body,
      FIN_CONTEXT,
    );

    const plan = planRow("meta/fin");
    if (plan.action !== "decrypt") throw new Error("expected a decrypt row");
    const opened = await open(mk, envelope, plan.context);
    expect(opened.meta.n).toBe("fin.json");
    expect(JSON.parse(new TextDecoder().decode(opened.bytes))).toEqual({
      v: 2,
      cash: 1,
    });
  });
});
