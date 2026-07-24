import { describe, expect, it } from "vitest";
import { isRolledBack, isValidSeq, nextSeq, servedSeqOf } from "./seqrule";

describe("isValidSeq", () => {
  it("accepts absent and non-negative safe integers only", () => {
    expect(isValidSeq(undefined)).toBe(true);
    expect(isValidSeq(0)).toBe(true);
    expect(isValidSeq(7)).toBe(true);
    expect(isValidSeq(-1)).toBe(false);
    expect(isValidSeq(1.5)).toBe(false);
    expect(isValidSeq("7")).toBe(false);
    expect(isValidSeq(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isValidSeq(null)).toBe(false);
  });
});

describe("nextSeq / servedSeqOf", () => {
  it("pre-feature blobs count from genesis and heal at the first save", () => {
    expect(nextSeq({})).toBe(1);
    expect(nextSeq({ seq: 41 })).toBe(42);
    expect(servedSeqOf({})).toBe(0);
    expect(servedSeqOf({ seq: 3 })).toBe(3);
    // An absent record reads as genesis too — so a store 404ing a record this
    // device has seen trips the same rollback predicate, no special case.
    expect(servedSeqOf(null)).toBe(0);
  });
});

describe("isRolledBack", () => {
  it("alarms only when the store serves LESS than this device has verified", () => {
    expect(isRolledBack(5, 6)).toBe(true); // older envelope re-served
    expect(isRolledBack(0, 3)).toBe(true); // record vanished / pre-seq blob resurrected
    expect(isRolledBack(6, 6)).toBe(false); // same state (or a lost-update twin — accepted)
    expect(isRolledBack(7, 6)).toBe(false); // normal forward progress
    expect(isRolledBack(0, null)).toBe(false); // no memory yet — trust and record
    expect(isRolledBack(9, null)).toBe(false);
  });
});
