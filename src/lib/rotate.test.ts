import { describe, expect, it } from "vitest";
import {
  beginPromoting,
  beginVerifying,
  beginWalking,
  canResume,
  isKeystoreV3,
  isRotationJournal,
  newJournal,
  planRotation,
  recordRewritten,
  recordVerified,
  type KeystoreV3,
  type RotationJournal,
} from "./rotate";

// A fixed timestamp — startedAt is informational and never gated on, so pinning it
// keeps the journals deterministic.
const T = "2026-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// the crash matrix — the heart of the suite
// ---------------------------------------------------------------------------
//
// A tiny in-memory model of the three stored objects a rotation touches, and a
// driver that executes the WHOLE rotation as a scripted sequence of ATOMIC steps
// (each step = one store mutation + the matching journal transition). Killing the
// driver after every single step and resuming from the journal proves the
// invariant that forbids data loss: at every instant, every blob's key is one the
// keystore still wraps.

type Key = "MK1" | "MK2";

interface FakeStore {
  /** The keystore's two-wrap state: the primary is what everyday reads unwrap; the
   *  pending is the second wrap held only during a rotation. */
  keystore: { primaryKey: Key; pendingKey?: Key };
  /** path → which key the blob is currently sealed under. */
  blobs: Map<string, Key>;
  journal: RotationJournal | null;
}

const LISTING = [
  "vault/1.bin",
  "vault/2.bin",
  "vault/3.bin",
  "vault/4.bin",
  "vault/5.bin",
];
const ROTATION_ID = "rot-crashmatrix";

function freshStore(listing: string[]): FakeStore {
  return {
    keystore: { primaryKey: "MK1" },
    blobs: new Map(listing.map((p) => [p, "MK1" as Key])),
    journal: null,
  };
}

/** THE invariant: every blob is sealed under a key the keystore still wraps. */
function assertInvariant(s: FakeStore): void {
  const wrapped = new Set<Key>([s.keystore.primaryKey]);
  if (s.keystore.pendingKey) wrapped.add(s.keystore.pendingKey);
  for (const [path, key] of s.blobs) {
    expect(
      wrapped.has(key),
      `blob ${path} sealed under ${key}, keystore wraps {${[...wrapped].join(", ")}}`,
    ).toBe(true);
  }
}

/** A KeystoreV3 view of the fake keystore — synthesised so `canResume` can be
 *  exercised during resume. The pending wrap shares the rotation's id, exactly as
 *  step 1 wrote them together. */
function ksView(s: FakeStore, rotationId: string): KeystoreV3 {
  const ks: KeystoreV3 = {
    v: 3,
    kdf: { salt_b64: "s", iterations: 600_000 },
    wrapped_mk_b64: s.keystore.primaryKey === "MK1" ? "wrap1" : "wrap2",
    iv_b64: "iv",
  };
  if (s.keystore.pendingKey !== undefined) {
    ks.pending = {
      wrapped_mk_b64: s.keystore.pendingKey === "MK1" ? "wrap1" : "wrap2",
      iv_b64: "iv2",
      rotation_id: rotationId,
    };
  }
  return ks;
}

/**
 * The happy-path rotation as an ordered list of atomic steps. Each closure makes
 * exactly one store mutation AND the matching journal transition — the two are one
 * atomic unit, so a "crash" only ever lands between whole steps.
 */
function buildSteps(
  listing: string[],
  rotationId: string,
): Array<(s: FakeStore) => void> {
  const steps: Array<(s: FakeStore) => void> = [];
  // 1. write the two-wrap keystore + the fresh journal, together
  steps.push((s) => {
    s.keystore = { primaryKey: "MK1", pendingKey: "MK2" };
    s.journal = newJournal(rotationId, T);
  });
  // 2. dual-wrapped → walking
  steps.push((s) => {
    s.journal = beginWalking(s.journal!);
  });
  // 3. re-seal each blob under MK2, recording it
  for (const path of listing) {
    steps.push((s) => {
      s.blobs.set(path, "MK2");
      s.journal = recordRewritten(s.journal!, path);
    });
  }
  // 4. walking → verifying (gate: everything rewritten)
  steps.push((s) => {
    s.journal = beginVerifying(s.journal!, listing);
  });
  // 5. confirm each blob opens under MK2, recording it
  for (const path of listing) {
    steps.push((s) => {
      if (s.blobs.get(path) !== "MK2")
        throw new Error(`verify: ${path} is not MK2`);
      s.journal = recordVerified(s.journal!, path);
    });
  }
  // 6. verifying → promoting (gate: everything verified)
  steps.push((s) => {
    s.journal = beginPromoting(s.journal!, listing);
  });
  // 7. promote: primary = MK2, DROP the pending wrap, delete the journal
  steps.push((s) => {
    s.keystore = { primaryKey: "MK2" };
    s.journal = null;
  });
  return steps;
}

/**
 * Resume a rotation from whatever partial state the store is in and drive it to
 * completion, using only planRotation + canResume + the transition guards — the
 * same functions a real device would. Asserts the invariant after each mutation.
 */
function driveToCompletion(
  store: FakeStore,
  listing: string[],
  rotationId: string,
): void {
  if (store.journal === null) return; // already promoted + cleaned
  let journal: RotationJournal = store.journal;
  expect(canResume(journal, ksView(store, rotationId))).toBe("resume");

  if (journal.phase === "dual-wrapped") {
    journal = beginWalking(journal);
    store.journal = journal;
  }
  if (journal.phase === "walking") {
    for (const path of planRotation(listing, journal).toRewrite) {
      store.blobs.set(path, "MK2");
      journal = recordRewritten(journal, path);
      store.journal = journal;
      assertInvariant(store);
    }
    journal = beginVerifying(journal, listing);
    store.journal = journal;
  }
  if (journal.phase === "verifying") {
    const plan = planRotation(listing, journal);
    expect(plan.toRewrite).toEqual([]); // single-threaded: no concurrent MK1 writes
    for (const path of plan.toVerify) {
      expect(store.blobs.get(path)).toBe("MK2");
      journal = recordVerified(journal, path);
      store.journal = journal;
    }
    journal = beginPromoting(journal, listing);
    store.journal = journal;
  }
  if (journal.phase === "promoting") {
    store.keystore = { primaryKey: "MK2" };
    store.journal = null;
    assertInvariant(store);
  }
}

function assertTerminal(store: FakeStore): void {
  expect(store.journal).toBeNull();
  expect(store.keystore).toEqual({ primaryKey: "MK2" });
  for (const [path, key] of store.blobs)
    expect(key, `blob ${path} should be MK2`).toBe("MK2");
}

describe("rotation crash matrix", () => {
  it("is resumable to a clean finish after a kill at EVERY step, invariant intact", () => {
    const steps = buildSteps(LISTING, ROTATION_ID);
    // 1 (dual-wrap) + 1 (walk) + 5 (rewrite) + 1 (verify-start) + 5 (verify) + 1
    // (promote-start) + 1 (promote) = 15 atomic steps.
    expect(steps.length).toBe(15);

    for (let k = 1; k <= steps.length; k++) {
      const store = freshStore(LISTING);
      for (let i = 0; i < k; i++) steps[i](store); // crash right after step k

      assertInvariant(store); // nothing is orphaned at the crash point

      driveToCompletion(store, LISTING, ROTATION_ID); // resume from the journal
      assertTerminal(store); // every kill point finishes clean
    }
  });

  it("rotates an empty store: every gate is vacuously satisfied", () => {
    let j = newJournal("rot-empty", T);
    expect(j.phase).toBe("dual-wrapped");
    j = beginWalking(j);
    j = beginVerifying(j, []); // vacuous — nothing to rewrite
    expect(j.phase).toBe("verifying");
    j = beginPromoting(j, []); // vacuous — nothing to verify
    expect(j.phase).toBe("promoting");
    expect(planRotation([], j)).toEqual({ toRewrite: [], toVerify: [] });
  });
});

// ---------------------------------------------------------------------------
// the gates
// ---------------------------------------------------------------------------

describe("phase gates", () => {
  it("beginVerifying refuses while any listing path is un-rewritten", () => {
    let j = beginWalking(newJournal("r", T));
    j = recordRewritten(j, "a");
    expect(() => beginVerifying(j, ["a", "b"])).toThrow(); // b not rewritten
    j = recordRewritten(j, "b");
    expect(beginVerifying(j, ["a", "b"]).phase).toBe("verifying"); // gate opens
  });

  it("beginPromoting refuses while any listing path is unverified", () => {
    let j = beginWalking(newJournal("r", T));
    j = recordRewritten(j, "a");
    j = recordRewritten(j, "b");
    j = beginVerifying(j, ["a", "b"]);
    j = recordVerified(j, "a");
    expect(() => beginPromoting(j, ["a", "b"])).toThrow(); // b not verified
    j = recordVerified(j, "b");
    expect(beginPromoting(j, ["a", "b"]).phase).toBe("promoting"); // gate opens
  });
});

// ---------------------------------------------------------------------------
// planRotation — resumability across phases
// ---------------------------------------------------------------------------

describe("planRotation", () => {
  const listing = ["a", "b", "c"];

  it("dual-wrapped → everything to rewrite, nothing to verify", () => {
    expect(planRotation(listing, newJournal("r", T))).toEqual({
      toRewrite: ["a", "b", "c"],
      toVerify: [],
    });
  });

  it("mid-walk → exactly the un-rewritten paths, in listing order", () => {
    let j = beginWalking(newJournal("r", T));
    j = recordRewritten(j, "b"); // rewrote b out of order
    expect(planRotation(listing, j)).toEqual({
      toRewrite: ["a", "c"],
      toVerify: [],
    });
  });

  it("mid-verify → exactly the un-verified paths", () => {
    let j = beginWalking(newJournal("r", T));
    for (const p of listing) j = recordRewritten(j, p);
    j = beginVerifying(j, listing);
    j = recordVerified(j, "a");
    expect(planRotation(listing, j)).toEqual({
      toRewrite: [],
      toVerify: ["b", "c"],
    });
  });

  it("a NEW path appearing mid-verify (written under MK1 by another device) lands in toRewrite", () => {
    let j = beginWalking(newJournal("r", T));
    for (const p of listing) j = recordRewritten(j, p);
    j = beginVerifying(j, listing);
    for (const p of listing) j = recordVerified(j, p);
    // another device wrote vault/new.bin under MK1 → it's now in the live listing
    const grown = [...listing, "new"];
    const plan = planRotation(grown, j);
    expect(plan.toRewrite).toEqual(["new"]); // re-enters the walk
    expect(plan.toVerify).toEqual([]); // it isn't verifiable yet; the rest are verified
  });

  it("promoting → nothing left", () => {
    let j = beginWalking(newJournal("r", T));
    for (const p of listing) j = recordRewritten(j, p);
    j = beginVerifying(j, listing);
    for (const p of listing) j = recordVerified(j, p);
    j = beginPromoting(j, listing);
    expect(planRotation(listing, j)).toEqual({ toRewrite: [], toVerify: [] });
  });

  it("preserves listing order (no sorting surprises)", () => {
    expect(planRotation(["z", "a", "m"], newJournal("r", T)).toRewrite).toEqual(
      ["z", "a", "m"],
    );
  });
});

// ---------------------------------------------------------------------------
// transition guards — idempotency, gating, purity
// ---------------------------------------------------------------------------

describe("transition guards", () => {
  it("recordRewritten is idempotent per path and never mutates its input", () => {
    let j = beginWalking(newJournal("r", T));
    j = recordRewritten(j, "a");
    const once = j;
    j = recordRewritten(j, "a"); // same path again
    expect(j.rewritten).toEqual(["a"]); // no duplicate
    expect(once.rewritten).toEqual(["a"]); // original untouched
  });

  it("recordVerified is idempotent and throws for a path never rewritten", () => {
    let j = beginWalking(newJournal("r", T));
    j = recordRewritten(j, "a");
    j = beginVerifying(j, ["a"]);
    expect(() => recordVerified(j, "ghost")).toThrow(); // never rewritten
    j = recordVerified(j, "a");
    const once = j;
    j = recordVerified(j, "a"); // again
    expect(j.verified).toEqual(["a"]); // no duplicate
    expect(once.verified).toEqual(["a"]);
  });

  it("every transition throws when called in the wrong phase", () => {
    const dual = newJournal("r", T);
    const walking = beginWalking(dual);
    const verifying = beginVerifying(recordRewritten(walking, "a"), ["a"]);
    const promoting = beginPromoting(recordVerified(verifying, "a"), ["a"]);

    // beginWalking: from dual-wrapped only
    expect(() => beginWalking(walking)).toThrow();
    expect(() => beginWalking(verifying)).toThrow();
    expect(() => beginWalking(promoting)).toThrow();
    // recordRewritten: walking only
    expect(() => recordRewritten(dual, "a")).toThrow();
    expect(() => recordRewritten(verifying, "a")).toThrow();
    expect(() => recordRewritten(promoting, "a")).toThrow();
    // beginVerifying: walking only
    expect(() => beginVerifying(dual, [])).toThrow();
    expect(() => beginVerifying(verifying, ["a"])).toThrow();
    expect(() => beginVerifying(promoting, ["a"])).toThrow();
    // recordVerified: verifying only
    expect(() => recordVerified(dual, "a")).toThrow();
    expect(() => recordVerified(walking, "a")).toThrow();
    expect(() => recordVerified(promoting, "a")).toThrow();
    // beginPromoting: verifying only
    expect(() => beginPromoting(dual, [])).toThrow();
    expect(() => beginPromoting(walking, [])).toThrow();
    expect(() => beginPromoting(promoting, [])).toThrow();
  });

  it("a transition never mutates the journal it is handed", () => {
    const j = beginWalking(newJournal("r", T));
    const snapshot = JSON.parse(JSON.stringify(j));
    recordRewritten(j, "a");
    beginVerifying({ ...j, rewritten: ["a"], phase: "walking" }, ["a"]);
    expect(j).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// canResume
// ---------------------------------------------------------------------------

describe("canResume", () => {
  const journal = newJournal("rot-1", T);
  const withPending = (id: string): KeystoreV3 => ({
    v: 3,
    kdf: { salt_b64: "s", iterations: 600_000 },
    wrapped_mk_b64: "w",
    iv_b64: "iv",
    pending: { wrapped_mk_b64: "w2", iv_b64: "iv2", rotation_id: id },
  });

  it("resumes when the keystore's pending rotation matches the journal id", () => {
    expect(canResume(journal, withPending("rot-1"))).toBe("resume");
  });

  it("refuses a keystore whose pending rotation is a different id", () => {
    expect(canResume(journal, withPending("rot-2"))).toBe("refuse");
  });

  it("refuses a keystore with no pending wrap (not mid-rotation)", () => {
    const noPending: KeystoreV3 = {
      v: 3,
      kdf: { salt_b64: "s", iterations: 600_000 },
      wrapped_mk_b64: "w",
      iv_b64: "iv",
    };
    expect(canResume(journal, noPending)).toBe("refuse");
  });
});

// ---------------------------------------------------------------------------
// newJournal
// ---------------------------------------------------------------------------

describe("newJournal", () => {
  it("starts a rotation dual-wrapped with empty progress", () => {
    const j = newJournal("rot-xyz", T);
    expect(j).toEqual({
      v: 1,
      id: "rot-xyz",
      startedAt: T,
      phase: "dual-wrapped",
      rewritten: [],
      verified: [],
    });
    expect(isRotationJournal(j)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isKeystoreV3
// ---------------------------------------------------------------------------

describe("isKeystoreV3", () => {
  const valid: KeystoreV3 = {
    v: 3,
    kdf: { salt_b64: "s", iterations: 600_000 },
    wrapped_mk_b64: "w",
    iv_b64: "iv",
  };
  const withPending: KeystoreV3 = {
    ...valid,
    pending: { wrapped_mk_b64: "w2", iv_b64: "iv2", rotation_id: "r" },
  };

  it("accepts v3 with and without pending/canary, and tolerates extra keys", () => {
    expect(isKeystoreV3(valid)).toBe(true);
    expect(isKeystoreV3(withPending)).toBe(true);
    expect(isKeystoreV3({ ...valid, canary_b64: "c" })).toBe(true);
    expect(isKeystoreV3({ ...withPending, canary_b64: "c" })).toBe(true);
    expect(isKeystoreV3({ ...valid, note: "forward-compat" })).toBe(true);
  });

  it("rejects a v2-shaped keystore (and other wrong versions)", () => {
    expect(
      isKeystoreV3({
        v: 2,
        kdf: { salt_b64: "s", iterations: 600_000 },
        wrapped_mk_b64: "w",
        iv_b64: "iv",
        canary_b64: "c",
      }),
    ).toBe(false);
    expect(isKeystoreV3({ ...valid, v: 1 })).toBe(false);
  });

  it("rejects non-objects and junk", () => {
    expect(isKeystoreV3(null)).toBe(false);
    expect(isKeystoreV3("x")).toBe(false);
    expect(isKeystoreV3(3)).toBe(false);
    expect(isKeystoreV3([])).toBe(false);
  });

  it("rejects missing or malformed base fields", () => {
    expect(isKeystoreV3({ ...valid, kdf: undefined })).toBe(false);
    expect(
      isKeystoreV3({ ...valid, kdf: { salt_b64: "s", iterations: 50 } }),
    ).toBe(false); // too few iterations
    expect(
      isKeystoreV3({ ...valid, kdf: { salt_b64: 5, iterations: 600_000 } }),
    ).toBe(false);
    expect(isKeystoreV3({ ...valid, wrapped_mk_b64: "" })).toBe(false);
    expect(isKeystoreV3({ ...valid, iv_b64: "" })).toBe(false);
    expect(isKeystoreV3({ v: 3, kdf: valid.kdf, iv_b64: "iv" })).toBe(false); // no wrapped_mk_b64
  });

  it("rejects a malformed pending block", () => {
    expect(isKeystoreV3({ ...valid, pending: null })).toBe(false);
    expect(isKeystoreV3({ ...valid, pending: "nope" })).toBe(false);
    expect(isKeystoreV3({ ...valid, pending: {} })).toBe(false);
    expect(
      isKeystoreV3({
        ...valid,
        pending: { wrapped_mk_b64: "w2", iv_b64: "iv2" },
      }),
    ).toBe(false); // no rotation_id
    expect(
      isKeystoreV3({
        ...valid,
        pending: { wrapped_mk_b64: "", iv_b64: "iv2", rotation_id: "r" },
      }),
    ).toBe(false);
    expect(
      isKeystoreV3({
        ...valid,
        pending: { wrapped_mk_b64: "w2", iv_b64: "iv2", rotation_id: "" },
      }),
    ).toBe(false);
  });

  it("rejects a malformed canary", () => {
    expect(isKeystoreV3({ ...valid, canary_b64: "" })).toBe(false);
    expect(isKeystoreV3({ ...valid, canary_b64: 5 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRotationJournal
// ---------------------------------------------------------------------------

describe("isRotationJournal", () => {
  const valid = newJournal("r", T);

  it("accepts a fresh journal, every phase in the vocabulary, and extra keys", () => {
    expect(isRotationJournal(valid)).toBe(true);
    for (const phase of ["dual-wrapped", "walking", "verifying", "promoting"]) {
      expect(isRotationJournal({ ...valid, phase })).toBe(true);
    }
    expect(isRotationJournal({ ...valid, note: "forward-compat" })).toBe(true);
  });

  it("rejects a phase outside the vocabulary", () => {
    expect(isRotationJournal({ ...valid, phase: "done" })).toBe(false);
    expect(isRotationJournal({ ...valid, phase: 3 })).toBe(false);
  });

  it("rejects non-objects, wrong version, and bad id/startedAt", () => {
    expect(isRotationJournal(null)).toBe(false);
    expect(isRotationJournal("x")).toBe(false);
    expect(isRotationJournal(1)).toBe(false);
    expect(isRotationJournal({ ...valid, v: 2 })).toBe(false);
    expect(isRotationJournal({ ...valid, id: "" })).toBe(false);
    expect(isRotationJournal({ ...valid, id: 5 })).toBe(false);
    expect(isRotationJournal({ ...valid, startedAt: 5 })).toBe(false);
  });

  it("rejects progress sets that aren't arrays of strings", () => {
    expect(isRotationJournal({ ...valid, rewritten: "a" })).toBe(false);
    expect(isRotationJournal({ ...valid, verified: {} })).toBe(false);
    expect(isRotationJournal({ ...valid, rewritten: [1, 2] })).toBe(false);
    expect(isRotationJournal({ ...valid, verified: ["ok", 5] })).toBe(false);
  });
});
