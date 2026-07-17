import { describe, expect, it } from "vitest";

import {
  ALL_METHODS,
  envelopeFuzz,
  headerSpoofs,
  ownerApiRoutes,
  ownerPageRoutes,
  publicInertRoutes,
  ROUTE_MANIFEST,
  SPOOF_NONCE,
  traversalPayloads,
  UNIFORMITY_HEADERS,
  type RouteEntry,
} from "./attack-corpus";

/**
 * Pins the attack corpus. The corpus is a spec: these assertions exist so it can
 * only change deliberately, in review — a probe silently dropped from the battery
 * is a regression, and this suite is where it gets caught. Byte-for-byte, not
 * "roughly": counts and contents are fixed.
 */

describe("route manifest", () => {
  it("declares a unique routeKey per entry", () => {
    const keys = ROUTE_MANIFEST.map((r) => r.routeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every entry a concrete probe path starting with /", () => {
    for (const r of ROUTE_MANIFEST) {
      expect(r.probe.startsWith("/"), `${r.routeKey} probe`).toBe(true);
      expect(r.methods.length, `${r.routeKey} methods`).toBeGreaterThan(0);
    }
  });

  it("requires a note on every non-owner shape (the deliberate departures)", () => {
    for (const r of ROUTE_MANIFEST) {
      const ownerShape = r.shape === "owner-api" || r.shape === "owner-page";
      if (!ownerShape) {
        expect(
          r.note,
          `${r.routeKey} must document why it isn't 404-walled`,
        ).toBeTruthy();
      }
    }
    // The two owner-api routes that deviate structurally still carry a note.
    const briefing = byKey("/api/briefing/ingest");
    const shareTarget = byKey("/files/share-target");
    expect(briefing.note).toBeTruthy();
    expect(shareTarget.note).toBeTruthy();
  });

  it("only declares real HTTP verbs (framework-auto OPTIONS/HEAD excluded)", () => {
    for (const r of ROUTE_MANIFEST) {
      for (const m of r.methods) {
        expect(ALL_METHODS).toContain(m);
        expect(
          m,
          `${r.routeKey} should not declare framework-auto ${m}`,
        ).not.toBe("OPTIONS");
        expect(
          m,
          `${r.routeKey} should not declare framework-auto ${m}`,
        ).not.toBe("HEAD");
      }
    }
  });

  it("partitions cleanly into the expected shape counts", () => {
    const count = (s: RouteEntry["shape"]) =>
      ROUTE_MANIFEST.filter((r) => r.shape === s).length;
    expect(count("owner-api")).toBe(22);
    expect(count("owner-page")).toBe(7);
    expect(count("public-inert")).toBe(2);
    expect(count("public-serving")).toBe(18);
    expect(count("auth-handler")).toBe(1);
    expect(count("cron")).toBe(1);
    expect(ROUTE_MANIFEST.length).toBe(51);
  });

  it("exposes the shape helpers matching the partition", () => {
    expect(ownerApiRoutes().length).toBe(22);
    expect(ownerPageRoutes().length).toBe(7);
    expect(publicInertRoutes().length).toBe(2);
  });
});

describe("traversalPayloads", () => {
  it("pins the ten spellings", () => {
    expect(traversalPayloads()).toEqual([
      "../meta/keystore",
      "..%2fmeta%2fkeystore",
      "..%252fmeta%252fkeystore",
      "%2e%2e/meta/keystore",
      "%2e%2e%2fmeta%2fkeystore",
      "..\\meta\\keystore",
      "..%5cmeta%5ckeystore",
      "../meta/keystore%00.bin",
      "%c0%ae%c0%ae/meta/keystore",
      "．．/meta/keystore",
    ]);
  });

  it("aims every spelling at the keystore", () => {
    for (const p of traversalPayloads()) {
      expect(p).toContain("keystore");
    }
  });

  it("prepends the prefix to each spelling", () => {
    const prefixed = traversalPayloads("inbox/");
    expect(prefixed).toHaveLength(10);
    for (const p of prefixed) expect(p.startsWith("inbox/")).toBe(true);
  });
});

describe("envelopeFuzz", () => {
  it("pins the dozen fuzz cases with stable labels", () => {
    const cases = envelopeFuzz(1024);
    expect(cases.map((c) => c.label)).toEqual([
      "empty",
      "zero-bytes-json",
      "truncated-magic",
      "wrong-magic",
      "valid-frame-garbage-body",
      "non-utf8",
      "unterminated-json",
      "json-null",
      "json-empty-array",
      "json-wrong-shape",
      "not-json",
      "oversized",
    ]);
  });

  it("sizes the oversized case just past the cap", () => {
    const cases = envelopeFuzz(1024);
    const oversized = cases.find((c) => c.label === "oversized");
    expect(oversized?.body).toBeInstanceOf(Uint8Array);
    expect((oversized?.body as Uint8Array).byteLength).toBe(1025);
  });

  it("frames the valid-magic case with AEV1 so only the body is garbage", () => {
    const framed = envelopeFuzz(1024).find(
      (c) => c.label === "valid-frame-garbage-body",
    );
    const bytes = framed?.body as Uint8Array;
    // "AEV1" magic, then non-envelope filler.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([
      0x41, 0x45, 0x56, 0x31,
    ]);
  });
});

describe("headerSpoofs", () => {
  it("pins the six spoof vectors", () => {
    expect(headerSpoofs().map((s) => s.label)).toEqual([
      "spoofed-x-nonce",
      "spoofed-csp-request-header",
      "middleware-subrequest-bypass",
      "forged-internal-routing",
      "junk-xff-garbage",
      "junk-xff-oversized",
    ]);
  });

  it("carries the smuggled nonce in the two CSP vectors", () => {
    const byLabel = Object.fromEntries(headerSpoofs().map((s) => [s.label, s]));
    expect(byLabel["spoofed-x-nonce"].headers["x-nonce"]).toBe(SPOOF_NONCE);
    expect(
      byLabel["spoofed-csp-request-header"].headers["content-security-policy"],
    ).toContain(SPOOF_NONCE);
  });
});

describe("method matrix + uniformity headers", () => {
  it("pins the seven verbs", () => {
    expect(ALL_METHODS).toEqual([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]);
  });

  it("compares only the seven security headers (never a hard-coded value)", () => {
    expect(UNIFORMITY_HEADERS).toEqual([
      "content-type",
      "content-security-policy",
      "x-frame-options",
      "x-content-type-options",
      "referrer-policy",
      "permissions-policy",
      "strict-transport-security",
    ]);
  });
});

function byKey(key: string): RouteEntry {
  const entry = ROUTE_MANIFEST.find((r) => r.routeKey === key);
  if (!entry) throw new Error(`no manifest entry for ${key}`);
  return entry;
}
