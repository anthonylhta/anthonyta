import { beforeAll, describe, expect, it } from "vitest";
import {
  appendEntry,
  compareTip,
  emptyLog,
  FOLD_CAP,
  FOLD_KEEP,
  GENESIS,
  isAuthLog,
  tipOf,
  verifyChain,
  type AuthEntry,
  type AuthEventKind,
  type AuthLog,
} from "./authlog";

// A fixed timestamp — ts is informational and NOT part of what the tip memory
// checks, so pinning it keeps the hashes deterministic across a rebuild.
const T = "2026-01-01T00:00:00.000Z";

/** Append `kinds.length` events (each with a distinct detail) to a fresh log. */
async function build(
  kinds: AuthEventKind[],
  details?: string[],
): Promise<AuthLog> {
  let log = emptyLog();
  for (let i = 0; i < kinds.length; i++) {
    log = await appendEntry(log, {
      kind: kinds[i],
      detail: details ? details[i] : `d${i + 1}`,
      ts: T,
    });
  }
  return log;
}

describe("appendEntry + verifyChain — round-trip", () => {
  it("five appended events verify, run seq 1..5, and survive a JSON round-trip", async () => {
    const log = await build([
      "signin",
      "register",
      "prf-add",
      "keystore",
      "remove",
    ]);
    expect(log.entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(log.foldedThrough).toBe(0);
    expect(log.carry).toBe(GENESIS);
    expect(await verifyChain(log)).toEqual({ ok: true });

    const round = JSON.parse(JSON.stringify(log)) as AuthLog;
    expect(isAuthLog(round)).toBe(true);
    expect(await verifyChain(round)).toEqual({ ok: true });
  });

  it("does not mutate its input", async () => {
    const before = await build(["signin", "register"]);
    const snapshot = JSON.parse(JSON.stringify(before));
    await appendEntry(before, { kind: "remove", detail: "x", ts: T });
    expect(before).toEqual(snapshot); // entries array + entries untouched
  });
});

describe("verifyChain — tamper detection", () => {
  it("editing entry 3's detail breaks the chain at exactly seq 3", async () => {
    const log = await build(["signin", "signin", "signin", "signin", "signin"]);
    const tampered: AuthLog = {
      ...log,
      entries: log.entries.map((e) => ({ ...e })),
    };
    tampered.entries[2].detail = "tampered"; // seq 3
    expect(await verifyChain(tampered)).toEqual({ ok: false, atSeq: 3 });
  });

  it("editing entry 3's ts or kind also breaks at seq 3", async () => {
    const base = await build(["signin", "signin", "signin", "signin"]);
    const editTs: AuthLog = {
      ...base,
      entries: base.entries.map((e) => ({ ...e })),
    };
    editTs.entries[2].ts = "2099-01-01T00:00:00.000Z";
    expect(await verifyChain(editTs)).toEqual({ ok: false, atSeq: 3 });

    const editKind: AuthLog = {
      ...base,
      entries: base.entries.map((e) => ({ ...e })),
    };
    editKind.entries[2].kind = "keystore";
    expect(await verifyChain(editKind)).toEqual({ ok: false, atSeq: 3 });
  });

  it("a middle deletion, renumbered to look contiguous, still breaks at the splice", async () => {
    const log = await build(["signin", "signin", "signin", "signin", "signin"]);
    // Drop entry 3 and renumber the tail so the seqs are contiguous again — what an
    // attacker must do to slip past isAuthLog's shape check. The stored hashes were
    // computed over the ORIGINAL prev-links, so the recompute diverges at the splice.
    const kept = [
      log.entries[0],
      log.entries[1],
      log.entries[3],
      log.entries[4],
    ].map((e, i) => ({ ...e, seq: i + 1 }));
    const spliced: AuthLog = {
      v: 1,
      foldedThrough: 0,
      carry: GENESIS,
      entries: kept,
    };
    expect(isAuthLog(spliced)).toBe(true); // contiguous → passes the shape guard
    expect(await verifyChain(spliced)).toEqual({ ok: false, atSeq: 3 });
  });

  it("a middle deletion WITHOUT renumbering is rejected by the shape guard", async () => {
    const log = await build(["signin", "signin", "signin", "signin", "signin"]);
    const holed: AuthLog = {
      ...log,
      entries: [log.entries[0], log.entries[1], log.entries[3], log.entries[4]], // seqs 1,2,4,5 — a gap
    };
    expect(isAuthLog(holed)).toBe(false);
  });
});

describe("compareTip — truncation + rewrite", () => {
  it("truncation still verifies, but the remembered tip is flagged rolled-back", async () => {
    const log = await build(["signin", "signin", "signin", "signin", "signin"]);
    const remembered = tipOf(log); // seq 5
    const truncated: AuthLog = { ...log, entries: log.entries.slice(0, 3) };
    expect(await verifyChain(truncated)).toEqual({ ok: true }); // every remaining link is honest
    expect(compareTip(remembered, truncated)).toBe("rolled-back");
  });

  it("a full rewrite re-verifies internally but the old tip catches it as rewritten", async () => {
    const honest = await build(
      ["signin", "signin", "signin", "signin", "signin"],
      ["d1", "d2", "d3", "d4", "d5"],
    );
    const remembered = tipOf(honest)!; // (seq 5, honest h)

    // Rebuild from scratch with entry 2 doctored — every downstream hash recomputed,
    // so the rewrite is a perfectly valid chain on its own.
    const doctored = await build(
      ["signin", "signin", "signin", "signin", "signin"],
      ["d1", "HACKED", "d3", "d4", "d5"],
    );
    expect(await verifyChain(doctored)).toEqual({ ok: true });
    expect(doctored.entries[4].h).not.toBe(remembered.h); // same seq, different tip hash
    expect(compareTip(remembered, doctored)).toBe("rewritten");
  });
});

describe("compareTip — the full verdict table", () => {
  it("null / equal / older-present / wrong-hash / newer", async () => {
    const log = await build(["signin", "signin", "signin", "signin"]);
    const tip = tipOf(log)!; // seq 4

    expect(compareTip(null, log)).toBe("ok"); // first sync
    expect(compareTip(tip, log)).toBe("ok"); // seen == tip
    expect(
      compareTip({ seq: log.entries[1].seq, h: log.entries[1].h }, log),
    ).toBe("ok"); // older, present, matching h
    expect(compareTip({ seq: 2, h: "not-the-hash" }, log)).toBe("rewritten"); // matching seq, wrong h
    expect(compareTip({ seq: 9, h: "x" }, log)).toBe("rolled-back"); // seen newer than tip
  });

  it("fold-boundary carry match/mismatch and folded-past acceptance", () => {
    // A hand-built folded log (compareTip never checks hashes, so opaque h's are fine):
    // entries 6,7 remain; 1..5 folded, the boundary held in carry.
    const log: AuthLog = {
      v: 1,
      foldedThrough: 5,
      carry: "CARRY5",
      entries: [
        { seq: 6, ts: T, kind: "signin", detail: "d6", h: "H6" },
        { seq: 7, ts: T, kind: "signin", detail: "d7", h: "H7" },
      ],
    };
    expect(isAuthLog(log)).toBe(true);
    expect(compareTip({ seq: 5, h: "CARRY5" }, log)).toBe("ok"); // boundary, carry matches
    expect(compareTip({ seq: 5, h: "WRONG" }, log)).toBe("rewritten"); // boundary, carry differs
    expect(compareTip({ seq: 3, h: "anything" }, log)).toBe("ok"); // folded past → accepted
    expect(compareTip({ seq: 7, h: "H7" }, log)).toBe("ok"); // seen == tip
    expect(compareTip({ seq: 8, h: "x" }, log)).toBe("rolled-back"); // newer than tip
  });

  it("a remembered tip against a truly empty log reads as rolled-back", () => {
    expect(compareTip({ seq: 3, h: "H3" }, emptyLog())).toBe("rolled-back");
  });
});

describe("appendEntry — fold cap", () => {
  it("folds past FOLD_CAP, keeps FOLD_KEEP, and stays verifiable across the boundary", async () => {
    let log = emptyLog();
    for (let i = 1; i <= FOLD_CAP + 1; i++) {
      log = await appendEntry(log, { kind: "signin", detail: `d${i}`, ts: T });
    }
    expect(log.foldedThrough).toBeGreaterThan(0);
    expect(log.entries.length).toBe(FOLD_KEEP);
    expect(await verifyChain(log)).toEqual({ ok: true }); // carry keeps the boundary honest
    expect(isAuthLog(log)).toBe(true);

    const tip = tipOf(log)!;
    expect(tip.seq).toBe(FOLD_CAP + 1);
    expect(tip.h).toBe(log.entries[log.entries.length - 1].h);
    // the first remaining entry picks up right after the fold boundary
    expect(log.entries[0].seq).toBe(log.foldedThrough + 1);

    // appending more keeps folding cleanly and still verifies
    for (let i = 0; i < 5; i++) {
      log = await appendEntry(log, { kind: "signin", detail: `x${i}`, ts: T });
    }
    expect(await verifyChain(log)).toEqual({ ok: true });
    expect(tipOf(log)!.seq).toBe(FOLD_CAP + 1 + 5);
    expect(log.entries.length).toBe(FOLD_KEEP + 5);
  });
});

describe("canonicalization", () => {
  it("hashes by fixed FIELD order, not object KEY order", async () => {
    // Two events with the same values but different key-insertion order must yield
    // the identical entry hash — canonical() pins the field order, so this can't
    // drift the way JSON.stringify of an object could across writers.
    const a = await appendEntry(emptyLog(), {
      kind: "signin",
      detail: "x",
      ts: T,
    });
    const b = await appendEntry(emptyLog(), {
      ts: T,
      detail: "x",
      kind: "signin",
    });
    expect(a.entries[0].h).toBe(b.entries[0].h);
  });

  it("a newline embedded in detail cannot forge a different entry", async () => {
    // detail is the LAST canonical field, so a "\n" inside it is pure data: it can't
    // shift the seq/ts/kind boundaries (those have fixed shapes — a number, an ISO
    // timestamp, a fixed-vocabulary kind — none containing "\n"). So a newline-laden
    // detail still hashes as its own entry, distinct from any other legitimate one,
    // and a chain carrying it verifies end-to-end.
    const base = emptyLog();
    const withNewline = await appendEntry(base, {
      kind: "signin",
      detail: "a\n5",
      ts: T,
    });
    const differentKind = await appendEntry(base, {
      kind: "register",
      detail: "a\n5",
      ts: T,
    });
    const differentDetail = await appendEntry(base, {
      kind: "signin",
      detail: "a",
      ts: T,
    });
    expect(withNewline.entries[0].h).not.toBe(differentKind.entries[0].h);
    expect(withNewline.entries[0].h).not.toBe(differentDetail.entries[0].h);
    expect(await verifyChain(withNewline)).toEqual({ ok: true });
  });
});

describe("isAuthLog", () => {
  let valid: AuthLog;
  beforeAll(async () => {
    valid = await build(["signin", "register", "prf-add"]);
  });

  it("accepts a valid log, a fresh empty log, a folded-empty log, and extra keys", () => {
    expect(isAuthLog(valid)).toBe(true);
    expect(isAuthLog(emptyLog())).toBe(true);
    expect(isAuthLog({ v: 1, foldedThrough: 3, carry: "C", entries: [] })).toBe(
      true,
    ); // folded-empty
    expect(isAuthLog({ ...valid, note: "forward-compat" })).toBe(true); // extra key
  });

  it("rejects non-objects, wrong version, bad foldedThrough, and bad carry", () => {
    expect(isAuthLog(null)).toBe(false);
    expect(isAuthLog("x")).toBe(false);
    expect(isAuthLog(42)).toBe(false);
    expect(isAuthLog({ ...valid, v: 2 })).toBe(false);
    expect(isAuthLog({ ...valid, foldedThrough: -1 })).toBe(false);
    expect(isAuthLog({ ...valid, foldedThrough: 1.5 })).toBe(false);
    expect(isAuthLog({ ...valid, foldedThrough: "0" })).toBe(false);
    expect(isAuthLog({ ...valid, carry: "" })).toBe(false);
    expect(isAuthLog({ ...valid, carry: 5 })).toBe(false);
  });

  it("rejects a non-array entries, a bad kind, and malformed entries", () => {
    expect(isAuthLog({ ...valid, entries: "nope" })).toBe(false);
    const withEntry = (patch: Record<string, unknown>): unknown => ({
      v: 1,
      foldedThrough: 0,
      carry: GENESIS,
      entries: [
        { seq: 1, ts: T, kind: "signin", detail: "d", h: "H", ...patch },
      ],
    });
    expect(isAuthLog(withEntry({ kind: "logout" }))).toBe(false); // not in the vocabulary
    expect(isAuthLog(withEntry({ detail: 5 }))).toBe(false); // detail not a string
    expect(isAuthLog(withEntry({ ts: 5 }))).toBe(false); // ts not a string
    expect(isAuthLog(withEntry({ h: undefined }))).toBe(false); // missing h
    expect(isAuthLog(withEntry({ seq: 1.5 }))).toBe(false); // seq not an integer
    expect(isAuthLog(withEntry({ detail: "" }))).toBe(true); // empty detail is legitimate
  });

  it("rejects non-contiguous seqs and a wrong start seq", () => {
    const gap: AuthLog = {
      v: 1,
      foldedThrough: 0,
      carry: GENESIS,
      entries: [
        { seq: 1, ts: T, kind: "signin", detail: "a", h: "H1" },
        { seq: 3, ts: T, kind: "signin", detail: "b", h: "H3" }, // skips 2
      ],
    };
    expect(isAuthLog(gap)).toBe(false);

    const wrongStart: AuthLog = {
      v: 1,
      foldedThrough: 5,
      carry: "C",
      entries: [{ seq: 7, ts: T, kind: "signin", detail: "a", h: "H" }], // should start at 6
    };
    expect(isAuthLog(wrongStart)).toBe(false);
  });
});

describe("emptyLog + tipOf edges", () => {
  it("a fresh empty log has the genesis shape and a null tip", () => {
    const log = emptyLog();
    expect(log).toEqual({
      v: 1,
      foldedThrough: 0,
      carry: GENESIS,
      entries: [],
    });
    expect(tipOf(log)).toBeNull();
  });

  it("a folded-empty log's tip is (foldedThrough, carry)", () => {
    const log: AuthLog = {
      v: 1,
      foldedThrough: 3,
      carry: "X",
      entries: [],
    };
    expect(tipOf(log)).toEqual({ seq: 3, h: "X" });
  });

  it("a non-empty log's tip is its newest entry", async () => {
    const log = await build(["signin", "register", "remove"]);
    const last: AuthEntry = log.entries[2];
    expect(tipOf(log)).toEqual({ seq: last.seq, h: last.h });
  });
});
