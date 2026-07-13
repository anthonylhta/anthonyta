import { describe, expect, it } from "vitest";
import {
  backupKeyToRelPath,
  buildManifest,
  isManifest,
  restoreKeyAllowed,
  type BackupEntry,
  type BackupManifest,
} from "./backup";

const HEX = "a".repeat(64); // a well-formed lowercase-hex SHA-256

const entry = (over: Partial<BackupEntry> = {}): BackupEntry => ({
  key: "meta/keystore",
  size: 128,
  sha256: HEX,
  ...over,
});

const manifest = (over: Partial<BackupManifest> = {}): BackupManifest => ({
  v: 1,
  created: "2026-07-13T00:00:00.000Z",
  count: 1,
  totalBytes: 128,
  entries: [entry()],
  ...over,
});

describe("backupKeyToRelPath", () => {
  it("accepts the keys the app actually writes", () => {
    for (const key of [
      "meta/keystore",
      "meta/fin",
      "meta/webauthn",
      "meta/snap/index.json",
      "vault/search-index.bin",
      "inbox/e-mB4d5S3CkQxGxUKz2AkKfg-aBcDeFgHiJkLmNoPqRsT.bin",
    ]) {
      expect(backupKeyToRelPath(key)).toBe(key);
    }
  });
  it("rejects a traversal segment", () => {
    expect(backupKeyToRelPath("meta/../evil")).toBeNull();
    expect(backupKeyToRelPath("../meta/keystore")).toBeNull();
    expect(backupKeyToRelPath("vault/../../etc/passwd")).toBeNull();
  });
  it("rejects a lone-dot segment", () => {
    expect(backupKeyToRelPath("meta/./keystore")).toBeNull();
  });
  it("rejects an absolute key (leading slash → empty first segment)", () => {
    expect(backupKeyToRelPath("/meta/keystore")).toBeNull();
  });
  it("rejects empty segments (double, trailing, or a bare slash)", () => {
    expect(backupKeyToRelPath("meta//keystore")).toBeNull();
    expect(backupKeyToRelPath("meta/keystore/")).toBeNull();
    expect(backupKeyToRelPath("/")).toBeNull();
  });
  it("rejects bytes outside the machine-key charset", () => {
    expect(backupKeyToRelPath("meta/key store")).toBeNull(); // space
    expect(backupKeyToRelPath("meta\\keystore")).toBeNull(); // backslash
    expect(backupKeyToRelPath("meta/%2e%2e")).toBeNull(); // percent probe
    expect(backupKeyToRelPath("meta/naïve")).toBeNull(); // non-ascii
  });
  it("rejects the empty string and non-strings", () => {
    expect(backupKeyToRelPath("")).toBeNull();
    expect(backupKeyToRelPath(null)).toBeNull();
    expect(backupKeyToRelPath(undefined)).toBeNull();
    expect(backupKeyToRelPath(42)).toBeNull();
  });
});

describe("restoreKeyAllowed", () => {
  it("allows the three backed-up prefixes", () => {
    expect(restoreKeyAllowed("meta/keystore")).toBe(true);
    expect(restoreKeyAllowed("inbox/e-x.bin")).toBe(true);
    expect(restoreKeyAllowed("vault/abc.bin")).toBe(true);
  });
  it("refuses everything else", () => {
    expect(restoreKeyAllowed("share/123-e-x.bin")).toBe(false); // ephemeral, never backed up
    expect(restoreKeyAllowed("other/x")).toBe(false);
    expect(restoreKeyAllowed("keystore")).toBe(false); // no prefix
    expect(restoreKeyAllowed("")).toBe(false);
    expect(restoreKeyAllowed("metastore/x")).toBe(false); // not the meta/ boundary
  });
});

describe("isManifest", () => {
  it("accepts a well-formed manifest", () => {
    expect(isManifest(manifest())).toBe(true);
  });
  it("rejects a wrong or missing version", () => {
    expect(isManifest(manifest({ v: 2 as unknown as 1 }))).toBe(false);
    const noV: Record<string, unknown> = { ...manifest() };
    delete noV.v;
    expect(isManifest(noV)).toBe(false);
  });
  it("rejects a non-object", () => {
    expect(isManifest(null)).toBe(false);
    expect(isManifest("nope")).toBe(false);
    expect(isManifest(42)).toBe(false);
  });
  it("rejects a bad created stamp", () => {
    expect(isManifest(manifest({ created: "" }))).toBe(false);
    expect(isManifest(manifest({ created: 0 as unknown as string }))).toBe(
      false,
    );
  });
  it("rejects non-integer or negative counters", () => {
    expect(isManifest(manifest({ count: 1.5 }))).toBe(false);
    expect(isManifest(manifest({ totalBytes: -1 }))).toBe(false);
  });
  it("rejects a count that disagrees with the entry rows", () => {
    expect(isManifest(manifest({ count: 2 }))).toBe(false);
  });
  it("rejects when entries is not an array", () => {
    expect(
      isManifest(manifest({ entries: {} as unknown as BackupEntry[] })),
    ).toBe(false);
  });
  it("rejects a bad sha256 — wrong length or uppercase", () => {
    expect(
      isManifest(manifest({ entries: [entry({ sha256: "a".repeat(63) })] })),
    ).toBe(false);
    expect(
      isManifest(manifest({ entries: [entry({ sha256: "a".repeat(65) })] })),
    ).toBe(false);
    expect(
      isManifest(manifest({ entries: [entry({ sha256: "A".repeat(64) })] })),
    ).toBe(false);
    expect(
      isManifest(manifest({ entries: [entry({ sha256: "g".repeat(64) })] })),
    ).toBe(false);
  });
  it("rejects an entry missing a field or with a bad size", () => {
    const noSha: Record<string, unknown> = { ...entry() };
    delete noSha.sha256;
    expect(
      isManifest(manifest({ entries: [noSha as unknown as BackupEntry] })),
    ).toBe(false);
    expect(isManifest(manifest({ entries: [entry({ size: -1 })] }))).toBe(
      false,
    );
    expect(isManifest(manifest({ entries: [entry({ size: 1.5 })] }))).toBe(
      false,
    );
    expect(isManifest(manifest({ entries: [entry({ key: "" })] }))).toBe(false);
  });
});

describe("buildManifest", () => {
  it("derives count and totalBytes, and round-trips through isManifest", () => {
    const entries = [
      entry({ key: "meta/keystore", size: 100 }),
      entry({ key: "vault/a.bin", size: 250 }),
    ];
    const built = buildManifest(entries, "2026-07-13T01:02:03.000Z");
    expect(built.v).toBe(1);
    expect(built.created).toBe("2026-07-13T01:02:03.000Z");
    expect(built.count).toBe(2);
    expect(built.totalBytes).toBe(350);
    expect(isManifest(built)).toBe(true);
  });
  it("builds a valid empty manifest", () => {
    const built = buildManifest([], "2026-07-13T00:00:00.000Z");
    expect(built.count).toBe(0);
    expect(built.totalBytes).toBe(0);
    expect(isManifest(built)).toBe(true);
  });
});
