import { describe, expect, it } from "vitest";
import { ROTATION_CONTEXT } from "./aevcontext";
import { AUTHLOG_PATH } from "./authlogstore";
import { BRIEFING_PATH } from "./briefingstore";
import { BACKUP_STAMP_PATH } from "./chores";
import { FIN_PATH, SNAP_INDEX_PATH } from "./finstore";
import { KEYSTORE_PATH } from "./inbox";
import { LAYOUT_PATH } from "./layoutstore";
import { PRF_WRAP_PATH } from "./prfstore";
import { classifyKey, partitionEstate, ROTATION_PATH } from "./rotationset";
import { STEPS_PATH } from "./stepsstore";
import { TFT_HISTORY_PATH } from "./tftstore";
import { TODO_PATH } from "./todostore";
import { TOTP_PATH } from "./totpstore";
import { TRANSIT_PATH } from "./transitstore";
import { WEBAUTHN_PATH } from "./webauthn/record";

// ---------------------------------------------------------------------------
// Drift guards — the classifier's literals pinned to the store modules' truth
// (the aevcontext.test.ts pattern). A moved path that ISN'T re-pinned here
// would classify `unknown` and refuse the rotation — fail-closed — but the
// pin turns silent refusal into a red build at the moment of the move.
// ---------------------------------------------------------------------------

describe("drift guards", () => {
  it("journal path = its AEV2 context = the store constants", () => {
    expect(ROTATION_PATH).toBe("meta/rotation");
    expect(ROTATION_CONTEXT).toBe(ROTATION_PATH);
  });

  it("classifier literals match the owning store modules", () => {
    // Exact skips.
    expect(classifyKey(KEYSTORE_PATH).action).toBe("skip");
    expect(classifyKey(PRF_WRAP_PATH).action).toBe("skip");
    expect(classifyKey(WEBAUTHN_PATH).action).toBe("skip");
    expect(classifyKey(AUTHLOG_PATH).action).toBe("skip");
    expect(classifyKey(LAYOUT_PATH).action).toBe("skip");
    expect(classifyKey(SNAP_INDEX_PATH).action).toBe("skip");
    // Prefix skips, pinned via the real store keys.
    expect(classifyKey(BRIEFING_PATH).action).toBe("skip");
    expect(classifyKey(STEPS_PATH).action).toBe("skip");
    expect(classifyKey(BACKUP_STAMP_PATH).action).toBe("skip");
    expect(classifyKey(TFT_HISTORY_PATH).action).toBe("skip");
    // Fixed config stores rewrite with their own path as AAD (ADR 0099).
    expect(classifyKey(FIN_PATH)).toEqual({
      action: "rewrite",
      kind: "envelope",
      context: FIN_PATH,
    });
    expect(classifyKey(TRANSIT_PATH)).toEqual({
      action: "rewrite",
      kind: "envelope",
      context: TRANSIT_PATH,
    });
    expect(classifyKey(TODO_PATH)).toEqual({
      action: "rewrite",
      kind: "envelope",
      context: TODO_PATH,
    });
    expect(classifyKey(TOTP_PATH)).toEqual({
      action: "rewrite",
      kind: "envelope",
      context: TOTP_PATH,
    });
  });
});

// ---------------------------------------------------------------------------
// classifyKey
// ---------------------------------------------------------------------------

const ID = "AAAAAAAAAAAAAAAAAAAAAA"; // 22 base64url chars

describe("classifyKey", () => {
  it("vault blobs rewrite as AEV1 envelopes; the manifest is its own kind", () => {
    expect(classifyKey(`vault/n-${ID}.bin`)).toEqual({
      action: "rewrite",
      kind: "envelope",
    });
    expect(classifyKey(`vault/i-${ID}.bin`)).toEqual({
      action: "rewrite",
      kind: "envelope",
    });
    expect(classifyKey("vault/index")).toEqual({
      action: "rewrite",
      kind: "envelope",
    });
    expect(classifyKey("vault/search-index.bin")).toEqual({
      action: "rewrite",
      kind: "envelope",
    });
    expect(classifyKey("vault/manifest.bin")).toEqual({
      action: "rewrite",
      kind: "manifest",
    });
    // No context on any of them — their readers open AEV1 (upgrading is the
    // ADR 0099 follow-up, never a rotation side effect).
    const note = classifyKey(`vault/n-${ID}.bin`);
    expect(note.action === "rewrite" && "context" in note).toBe(false);
  });

  it("a malformed vault key is unknown, not skipped", () => {
    expect(classifyKey("vault/rogue.bin").action).toBe("unknown");
    expect(classifyKey("vault/n-short.bin").action).toBe("unknown");
    expect(classifyKey("vault/../meta/keystore").action).toBe("unknown");
  });

  it("inbox envelopes rewrite; legacy plaintext rows skip; junk is unknown", () => {
    expect(classifyKey(`inbox/e-${ID}.bin`)).toEqual({
      action: "rewrite",
      kind: "envelope",
    });
    expect(classifyKey("inbox/holiday.jpg").action).toBe("skip");
    expect(classifyKey("inbox/../meta/keystore").action).toBe("unknown");
  });

  it("share and dropbox message blobs skip — never MK-sealed", () => {
    expect(classifyKey(`share/1893456000-e-${ID}.bin`).action).toBe("skip");
    expect(classifyKey(`dropbox/${ID}.bin`).action).toBe("skip");
  });

  it("the dropbox key record is its own rewrite kind", () => {
    expect(classifyKey("meta/dropboxkey")).toEqual({
      action: "rewrite",
      kind: "dropboxkey",
    });
  });

  it("the retired sealed-box relics are unknown — cleanup is forced, not silent", () => {
    expect(classifyKey("meta/snapkey").action).toBe("unknown");
    expect(classifyKey("meta/snap/2026-07-01.bin").action).toBe("unknown");
  });

  it("anything unrecognized is unknown — a future store can't slip through", () => {
    expect(classifyKey("meta/newfeature").action).toBe("unknown");
    expect(classifyKey("meta/analytics2/x").action).toBe("unknown");
    expect(classifyKey("backups/2026.tar").action).toBe("unknown");
    expect(classifyKey("").action).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// partitionEstate
// ---------------------------------------------------------------------------

describe("partitionEstate", () => {
  const estate = [
    "vault/manifest.bin", // listed FIRST — must still walk LAST
    `vault/n-${ID}.bin`,
    "meta/fin",
    `inbox/e-${ID}.bin`,
    "meta/keystore",
    "meta/dropboxkey",
    `share/1893456000-e-${ID}.bin`,
    "meta/analytics/salt",
  ];

  it("orders the walk with the manifest last and preserves listing order otherwise", () => {
    const p = partitionEstate(estate);
    expect(p.walk).toEqual([
      `vault/n-${ID}.bin`,
      "meta/fin",
      `inbox/e-${ID}.bin`,
      "meta/dropboxkey",
      "vault/manifest.bin",
    ]);
    expect(p.unknown).toEqual([]);
    expect(p.skipped.map((s) => s.key)).toEqual([
      "meta/keystore",
      `share/1893456000-e-${ID}.bin`,
      "meta/analytics/salt",
    ]);
  });

  it("one unknown key poisons the partition — the walk must refuse", () => {
    const p = partitionEstate([...estate, "meta/snapkey"]);
    expect(p.unknown).toEqual(["meta/snapkey"]);
  });

  it("every skip carries its recorded reason", () => {
    const p = partitionEstate(estate);
    for (const s of p.skipped) {
      expect(s.verdict.action).toBe("skip");
      if (s.verdict.action === "skip")
        expect(s.verdict.reason.length).toBeGreaterThan(0);
    }
  });
});
