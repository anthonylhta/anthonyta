import { describe, expect, it } from "vitest";
import {
  appendCred,
  isWebauthnRecord,
  MAX_CREDS,
  newRecord,
  removeCred,
  WEBAUTHN_MAX_BYTES,
  withCounter,
  withoutRecovery,
  withRecovery,
  type WebauthnCred,
} from "./record";

const cred = (over: Partial<WebauthnCred> = {}): WebauthnCred => ({
  id: "credential-id-b64url",
  pk: "A".repeat(120), // a realistic COSE ES256 key is ~77 bytes ≈ 103 b64url chars
  counter: 0,
  transports: ["internal", "hybrid"],
  label: "iphone",
  createdAt: "2026-07-10T00:00:00.000Z",
  ...over,
});

const record = () => ({ v: 1 as const, creds: [cred()] });

describe("isWebauthnRecord", () => {
  it("accepts a canonical record and the empty first-run record", () => {
    expect(isWebauthnRecord(record())).toBe(true);
    expect(isWebauthnRecord(newRecord())).toBe(true);
  });

  it("accepts a record carrying a recovery hash", () => {
    const r = withRecovery(record(), "h".repeat(43), "2026-07-10");
    expect(isWebauthnRecord(r)).toBe(true);
  });

  it("accepts an optional lastUsedAt and rejects a malformed one", () => {
    expect(
      isWebauthnRecord({
        v: 1,
        creds: [cred({ lastUsedAt: "2026-07-13T00:00:00.000Z" })],
      }),
    ).toBe(true);
    for (const bad of [5, "x".repeat(41)]) {
      expect(
        isWebauthnRecord({ v: 1, creds: [{ ...cred(), lastUsedAt: bad }] }),
      ).toBe(false);
    }
  });

  it("rejects non-objects and wrong versions", () => {
    for (const x of [null, undefined, 1, "x", [], { v: 2, creds: [] }]) {
      expect(isWebauthnRecord(x)).toBe(false);
    }
  });

  it("rejects malformed credentials field by field", () => {
    const bad: unknown[] = [
      { ...cred(), id: "" },
      { ...cred(), id: "x".repeat(201) },
      { ...cred(), pk: "" },
      { ...cred(), pk: "x".repeat(2001) },
      { ...cred(), counter: -1 },
      { ...cred(), counter: 1.5 },
      { ...cred(), counter: "0" },
      { ...cred(), transports: ["ok", 3] },
      { ...cred(), transports: [""] },
      { ...cred(), label: "" },
      { ...cred(), label: "x".repeat(65) },
      { ...cred(), createdAt: 5 },
    ];
    for (const c of bad) {
      expect(isWebauthnRecord({ v: 1, creds: [c] })).toBe(false);
    }
  });

  it("rejects an oversized creds array and a bad recovery shape", () => {
    const many = Array.from({ length: MAX_CREDS + 1 }, (_, i) =>
      cred({ id: `id-${i}` }),
    );
    expect(isWebauthnRecord({ v: 1, creds: many })).toBe(false);
    expect(
      isWebauthnRecord({ v: 1, creds: [], recovery: { hash_b64: "short" } }),
    ).toBe(false);
    expect(
      isWebauthnRecord({ v: 1, creds: [], recovery: "not-an-object" }),
    ).toBe(false);
  });

  it("keeps a full record under the byte cap", () => {
    let r = newRecord();
    for (let i = 0; i < MAX_CREDS; i++) {
      const next = appendCred(r, cred({ id: `credential-id-${i}` }));
      expect(next).not.toBeNull();
      r = next!;
    }
    const withRec = withRecovery(r, "h".repeat(43), "2026-07-10T00:00:00Z");
    expect(JSON.stringify(withRec).length).toBeLessThan(WEBAUTHN_MAX_BYTES);
  });
});

describe("mutations", () => {
  it("appendCred refuses duplicates and a full record", () => {
    const r = record();
    expect(appendCred(r, cred())).toBeNull(); // same id
    let full = newRecord();
    for (let i = 0; i < MAX_CREDS; i++) {
      full = appendCred(full, cred({ id: `id-${i}` }))!;
    }
    expect(appendCred(full, cred({ id: "one-more" }))).toBeNull();
  });

  it("withCounter touches only the matching credential", () => {
    let r = record();
    r = appendCred(r, cred({ id: "other", counter: 7 }))!;
    const next = withCounter(r, "other", 8);
    expect(next.creds.find((c) => c.id === "other")?.counter).toBe(8);
    expect(next.creds.find((c) => c.id !== "other")?.counter).toBe(0);
    // unknown id is a no-op, not a throw
    expect(withCounter(r, "missing", 99)).toEqual(r);
  });

  it("withCounter stamps lastUsedAt only when given, on the matching cred", () => {
    let r = record();
    r = appendCred(r, cred({ id: "other" }))!;
    const stamped = withCounter(r, "other", 3, "2026-07-13T01:00:00.000Z");
    expect(stamped.creds.find((c) => c.id === "other")?.lastUsedAt).toBe(
      "2026-07-13T01:00:00.000Z",
    );
    // the untouched cred keeps no stamp
    expect(
      stamped.creds.find((c) => c.id !== "other")?.lastUsedAt,
    ).toBeUndefined();
    // omitting usedAt leaves the field absent (a bare counter bump)
    expect(withCounter(r, "other", 3).creds[1].lastUsedAt).toBeUndefined();
  });

  it("removeCred: unknown id, last-cred refusal, and the allowed removals", () => {
    // unknown id → null
    expect(removeCred(record(), "missing")).toBeNull();

    // removing the LAST credential with no recovery code is refused (lockout)
    expect(removeCred(record(), cred().id)).toBeNull();

    // …but allowed once a recovery code is present
    const armed = withRecovery(record(), "h".repeat(43), "2026-07-13");
    const emptied = removeCred(armed, cred().id);
    expect(emptied?.creds).toEqual([]);
    expect(emptied?.recovery).toBeDefined();

    // a middle credential comes out, the rest stay
    let three = newRecord();
    for (const id of ["a", "b", "c"]) three = appendCred(three, cred({ id }))!;
    const without = removeCred(three, "b");
    expect(without?.creds.map((c) => c.id)).toEqual(["a", "c"]);

    // immutability — the source record is untouched
    expect(three.creds.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("recovery add / consume round-trip", () => {
    const armed = withRecovery(record(), "h".repeat(43), "2026-07-10");
    expect(armed.recovery?.hash_b64).toBe("h".repeat(43));
    const consumed = withoutRecovery(armed);
    expect(consumed.recovery).toBeUndefined();
    expect(consumed.creds).toEqual(armed.creds);
    expect(isWebauthnRecord(consumed)).toBe(true);
  });
});
