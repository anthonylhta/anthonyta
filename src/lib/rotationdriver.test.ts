import { describe, expect, it } from "vitest";
import { ROTATION_CONTEXT } from "./aevcontext";
import {
  buildKeystore,
  checkCanary,
  deriveKek,
  fromB64url,
  generateBoxKeypair,
  generateMk,
  isKeystore,
  randomSalt,
  seal,
  sealCanary,
  toB64url,
  unwrapMk,
  wrapMk,
  open,
  type Keystore,
} from "./crypto";
import type { DropboxKey } from "./dropbox";
import { buildManifest, hashBytes, isManifest, verifyManifest } from "./merkle";
import {
  beginRotation,
  completeRotation,
  finishStaleRotation,
  probeRotation,
  resumeRotation,
  RotationHalt,
  runWalk,
  type RotationIo,
  type RotationSession,
} from "./rotationdriver";
import { classifyKey } from "./rotationset";

// The whole engine runs against REAL crypto over an in-memory world: one Map is
// the bucket, and every store the live adapter fronts (keystore, journal,
// dropbox record, prf wraps) is just bytes at its real key — so the estate
// listing, the classifier, and the invariant checker all see exactly what a
// real bucket would hold.

const PASS = "correct horse battery staple";
// Real PBKDF2 at isKeystore's floor — the stored count must clear the guard
// (the crypto.test.ts lesson), and ~30ms/derive keeps the matrix affordable.
const FAST = 100_000;

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const NOTE = "vault/n-AAAAAAAAAAAAAAAAAAAAAA.bin";
const IMG = "vault/i-BBBBBBBBBBBBBBBBBBBBBB.bin";
const INBOX = "inbox/e-CCCCCCCCCCCCCCCCCCCCCC.bin";

class FakeIo implements RotationIo {
  store = new Map<string, Uint8Array>();
  /** Mutations before the crash; Infinity = never crash. */
  failAfter = Infinity;
  /** "before" = die without applying the write; "after" = apply, then die. */
  failMode: "before" | "after" = "before";
  muts = 0;

  private step(apply: () => void) {
    this.muts++;
    if (this.muts > this.failAfter && this.failMode === "before")
      throw new Error("CRASH(before)");
    apply();
    if (this.muts > this.failAfter && this.failMode === "after")
      throw new Error("CRASH(after)");
  }

  async getKeystore(): Promise<Keystore | null> {
    const raw = this.store.get("meta/keystore");
    if (!raw) return null;
    const parsed: unknown = JSON.parse(dec(raw));
    if (!isKeystore(parsed)) throw new Error("fake: bad keystore at rest");
    return parsed;
  }
  async putKeystore(ks: Keystore): Promise<boolean> {
    this.step(() => this.store.set("meta/keystore", enc(JSON.stringify(ks))));
    return true;
  }
  async getJournal(): Promise<Uint8Array | "absent" | "error"> {
    return this.store.get("meta/rotation") ?? "absent";
  }
  async putJournal(
    bytes: Uint8Array,
    overwrite: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    if (!overwrite && this.store.has("meta/rotation")) return "conflict";
    this.step(() => this.store.set("meta/rotation", bytes));
    return "ok";
  }
  async deleteJournal(): Promise<boolean> {
    this.step(() => this.store.delete("meta/rotation"));
    return true;
  }
  async listEstate(): Promise<string[] | null> {
    return [...this.store.keys()];
  }
  async readBlob(key: string): Promise<Uint8Array | null> {
    return this.store.get(key) ?? null;
  }
  async writeBlob(key: string, bytes: Uint8Array): Promise<boolean> {
    this.step(() => this.store.set(key, bytes));
    return true;
  }
  async getDropboxKey(): Promise<DropboxKey | null> {
    const raw = this.store.get("meta/dropboxkey");
    return raw ? (JSON.parse(dec(raw)) as DropboxKey) : null;
  }
  async putDropboxKey(rec: DropboxKey): Promise<boolean> {
    this.step(() =>
      this.store.set("meta/dropboxkey", enc(JSON.stringify(rec))),
    );
    return true;
  }
  async dropPrfWraps(): Promise<boolean> {
    this.step(() =>
      this.store.set("meta/prfwrap", enc(JSON.stringify({ v: 1, wraps: [] }))),
    );
    return true;
  }
}

interface World {
  io: FakeIo;
  mk1: CryptoKey;
  pubB64: string;
  priorEpoch: number;
}

/** Seed a realistic mini-estate under a fresh MK1: sealed configs (AEV2), vault
 *  blobs + manifest (AEV1), an inbox envelope, the dropbox record, plaintext
 *  skips, and the keystore itself. */
async function seedWorld(): Promise<World> {
  const io = new FakeIo();
  const salt = randomSalt();
  const kek = await deriveKek(PASS, salt, FAST);
  const mkx = await generateMk();
  const { wrapped, iv } = await wrapMk(mkx, kek);
  const mk1 = await unwrapMk(wrapped, iv, kek);
  const ks = buildKeystore(
    { salt_b64: toB64url(salt), iterations: FAST },
    wrapped,
    iv,
    await sealCanary(mk1),
  );
  io.store.set("meta/keystore", enc(JSON.stringify(ks)));

  const put = async (
    key: string,
    body: string,
    context?: string,
  ): Promise<Uint8Array> => {
    const bytes = enc(body);
    const sealed = await seal(
      mk1,
      { n: key, t: "text/plain", s: bytes.length },
      bytes,
      context,
    );
    io.store.set(key, sealed);
    return sealed;
  };

  await put("meta/fin", '{"v":2,"cash":1}', "meta/fin");
  await put("meta/transit", '{"v":1,"groups":[]}', "meta/transit");
  const noteEnv = await put(NOTE, "# journal");
  const imgEnv = await put(IMG, "fakeimagebytes");
  const idxEnv = await put("vault/index", '{"v":1,"notes":[],"images":[]}');
  const searchEnv = await put("vault/search-index.bin", "TGX1fake");
  await put(INBOX, "inbox file");

  const manifest = await buildManifest(
    [
      { path: NOTE, h: await hashBytes(noteEnv) },
      { path: IMG, h: await hashBytes(imgEnv) },
      { path: "vault/index", h: await hashBytes(idxEnv) },
      { path: "vault/search-index.bin", h: await hashBytes(searchEnv) },
    ],
    3,
  );
  const mBytes = enc(JSON.stringify(manifest));
  io.store.set(
    "vault/manifest.bin",
    await seal(
      mk1,
      { n: "manifest", t: "application/json", s: mBytes.length },
      mBytes,
    ),
  );

  const box = await generateBoxKeypair();
  const sealedPriv = await seal(
    mk1,
    {
      n: "dropbox-priv",
      t: "application/octet-stream",
      s: box.privPkcs8.length,
    },
    box.privPkcs8,
  );
  const pubB64 = toB64url(box.pubRaw);
  const rec: DropboxKey = {
    v: 1,
    alg: "ECDH-P256",
    pub_b64: pubB64,
    sealed_priv_b64: toB64url(sealedPriv),
  };
  io.store.set("meta/dropboxkey", enc(JSON.stringify(rec)));

  io.store.set(
    "meta/prfwrap",
    enc(JSON.stringify({ v: 1, wraps: [{ v: 1, credential_id_b64: "x" }] })),
  );
  // Not-MK blobs the classifier must skip untouched.
  io.store.set("meta/authlog", enc('{"chain":[]}'));
  io.store.set("meta/layout.json", enc('{"v":2}'));
  io.store.set("inbox/legacy-holiday.jpg", enc("plaintext legacy row"));
  io.store.set(
    "share/1893456000-e-DDDDDDDDDDDDDDDDDDDDDD.bin",
    enc("sharebytes"),
  );
  io.store.set("dropbox/EEEEEEEEEEEEEEEEEEEEEE.bin", enc("asb1bytes"));

  return { io, mk1, pubB64, priorEpoch: 3 };
}

/** THE invariant (ADR 0090): every MK-sealed blob opens under a key the stored
 *  keystore still wraps. Checked with nothing but the passphrase — exactly the
 *  position a device is in after any crash. */
async function assertInvariant(io: FakeIo): Promise<void> {
  const ks = await io.getKeystore();
  expect(ks).not.toBeNull();
  const kek = await deriveKek(
    PASS,
    fromB64url(ks!.kdf.salt_b64),
    (ks!.kdf as { iterations: number }).iterations,
  );
  const keys: CryptoKey[] = [
    await unwrapMk(fromB64url(ks!.wrapped_mk_b64), fromB64url(ks!.iv_b64), kek),
  ];
  if (ks!.v === 3 && ks!.pending)
    keys.push(
      await unwrapMk(
        fromB64url(ks!.pending.wrapped_mk_b64),
        fromB64url(ks!.pending.iv_b64),
        kek,
      ),
    );

  const opensUnderSome = async (bytes: Uint8Array, context?: string) => {
    for (const k of keys) {
      try {
        await open(k, bytes, context);
        return true;
      } catch {
        /* next key */
      }
    }
    return false;
  };

  for (const [key, bytes] of io.store) {
    const c = classifyKey(key);
    if (c.action !== "rewrite") continue;
    if (c.kind === "dropboxkey") {
      const rec = JSON.parse(dec(bytes)) as DropboxKey;
      expect(
        await opensUnderSome(fromB64url(rec.sealed_priv_b64)),
        `dropbox priv undecryptable`,
      ).toBe(true);
    } else {
      const context = c.kind === "envelope" ? c.context : undefined;
      expect(await opensUnderSome(bytes, context), `${key} undecryptable`).toBe(
        true,
      );
    }
  }
  // The journal itself must be readable too (under pending mid-rotation, under
  // the new primary after promotion) — else no device could ever resume.
  const j = io.store.get("meta/rotation");
  if (j) expect(await opensUnderSome(j, ROTATION_CONTEXT)).toBe(true);
}

/** Drive from any post-crash state to a completed rotation, exactly as the
 *  panel would: probe → finish-stale/resume/begin → walk → verify (looping
 *  rewalks) → promote. `seedKeystore` disambiguates the two idle states: a
 *  kill before the FIRST write leaves the world byte-identical to the seed
 *  (never started — begin fresh), while post-completion idle has a promoted
 *  keystore (done). */
async function driveToCompletion(
  io: FakeIo,
  seedKeystore: Uint8Array,
): Promise<void> {
  for (let guard = 0; guard < 8; guard++) {
    const status = await probeRotation(io);
    if (status === "idle") {
      const current = io.store.get("meta/keystore")!;
      if (dec(current) !== dec(seedKeystore)) return; // promoted — done
      const s = await beginRotation(io, PASS);
      if (await completeFrom(io, s)) return;
      continue;
    }
    if (status === "stale-journal") {
      await finishStaleRotation(io, PASS);
      continue;
    }
    expect(status).toBe("in-flight");
    const s = await resumeRotation(io, PASS);
    if (await completeFrom(io, s)) return;
  }
  throw new Error("did not converge");
}

/** walk → verify → promote from a live session; true = fully done. */
async function completeFrom(io: FakeIo, s: RotationSession): Promise<boolean> {
  const p = await completeRotation(io, s);
  return p.prfDropped && p.journalDeleted;
}

/** Post-completion assertions: everything under MK2 only, canary fresh, wraps
 *  dropped, journal gone, pub point untouched, manifest epoch+1 and honest. */
async function assertCompleted(w: World): Promise<void> {
  const { io } = w;
  const ks = await io.getKeystore();
  expect(ks!.v).toBe(2);
  expect(ks!.pending).toBeUndefined();
  const kek = await deriveKek(
    PASS,
    fromB64url(ks!.kdf.salt_b64),
    (ks!.kdf as { iterations: number }).iterations,
  );
  const mk2 = await unwrapMk(
    fromB64url(ks!.wrapped_mk_b64),
    fromB64url(ks!.iv_b64),
    kek,
  );
  expect(await checkCanary(mk2, ks!)).toBe(true);

  for (const [key, bytes] of io.store) {
    const c = classifyKey(key);
    if (c.action !== "rewrite") continue;
    if (c.kind === "dropboxkey") {
      const rec = JSON.parse(dec(bytes)) as DropboxKey;
      expect(rec.pub_b64).toBe(w.pubB64); // strangers still encrypt to it
      await open(mk2, fromB64url(rec.sealed_priv_b64));
      await expect(
        open(w.mk1, fromB64url(rec.sealed_priv_b64)),
      ).rejects.toThrow();
    } else {
      const context = c.kind === "envelope" ? c.context : undefined;
      await open(mk2, bytes, context); // throws = fail
      await expect(open(w.mk1, bytes, context)).rejects.toThrow();
    }
  }

  // Format preservation: vault stays AEV1, the AEV2 config stays AEV2.
  expect(dec(io.store.get(NOTE)!.slice(0, 4))).toBe("AEV1");
  expect(dec(io.store.get("meta/fin")!.slice(0, 4))).toBe("AEV2");

  const { bytes: mBytes } = await open(
    mk2,
    io.store.get("vault/manifest.bin")!,
  );
  const manifest: unknown = JSON.parse(dec(mBytes));
  expect(isManifest(manifest)).toBe(true);
  if (isManifest(manifest)) {
    expect(manifest.epoch).toBe(w.priorEpoch + 1);
    expect(await verifyManifest(manifest)).toBe(true);
    for (const e of manifest.entries)
      expect(e.h).toBe(await hashBytes(io.store.get(e.path)!));
  }

  expect(JSON.parse(dec(io.store.get("meta/prfwrap")!))).toEqual({
    v: 1,
    wraps: [],
  });
  expect(io.store.has("meta/rotation")).toBe(false);
  // Skips untouched.
  expect(dec(io.store.get("inbox/legacy-holiday.jpg")!)).toBe(
    "plaintext legacy row",
  );
  expect(dec(io.store.get("meta/authlog")!)).toBe('{"chain":[]}');
}

// ---------------------------------------------------------------------------

describe("happy path", () => {
  it("rotates the whole estate end to end", async () => {
    const w = await seedWorld();
    const s = await beginRotation(w.io, PASS);
    expect(await completeFrom(w.io, s)).toBe(true);
    await assertCompleted(w);
  });

  it("wrong passphrase refuses before touching anything", async () => {
    const w = await seedWorld();
    const muts = w.io.muts;
    await expect(beginRotation(w.io, "wrong")).rejects.toThrow("passphrase");
    expect(w.io.muts).toBe(muts);
  });

  it("begin refuses while a rotation is in flight", async () => {
    const w = await seedWorld();
    await beginRotation(w.io, PASS);
    await expect(beginRotation(w.io, PASS)).rejects.toMatchObject({
      code: "already-in-flight",
    });
  });
});

describe("fail-closed refusals", () => {
  it("an unknown key blocks the walk with nothing rewritten", async () => {
    const w = await seedWorld();
    w.io.store.set("meta/snapkey", enc("sealed-box relic"));
    const s = await beginRotation(w.io, PASS);
    const muts = w.io.muts;
    await expect(runWalk(w.io, s)).rejects.toMatchObject({
      code: "unknown-keys",
      keys: ["meta/snapkey"],
    });
    expect(w.io.muts).toBe(muts); // nothing advanced
    await assertInvariant(w.io);
  });

  it("a blob under NEITHER key halts by name and promotion stays unreachable", async () => {
    const w = await seedWorld();
    w.io.store.set(NOTE, enc("AEV1garbage-not-an-envelope....."));
    const s = await beginRotation(w.io, PASS);
    await expect(runWalk(w.io, s)).rejects.toMatchObject({
      code: "unopenable",
      keys: [NOTE],
    });
    const ks = await w.io.getKeystore();
    expect(ks!.v).toBe(3); // still dual-wrapped — MK1 not retired
  });
});

describe("mid-rotation writers", () => {
  it("a new MK1 blob after the walk forces a rewalk and still completes", async () => {
    const w = await seedWorld();
    const s = await beginRotation(w.io, PASS);
    await runWalk(w.io, s); // journal now verifying
    const late = "inbox/e-FFFFFFFFFFFFFFFFFFFFFF.bin";
    const bytes = enc("late file");
    w.io.store.set(
      late,
      await seal(w.mk1, { n: late, t: "text/plain", s: bytes.length }, bytes),
    );
    expect(await completeFrom(w.io, s)).toBe(true);
    await assertCompleted(w);
  });

  it("a rewritten blob reverted to MK1 is re-sealed during verify", async () => {
    const w = await seedWorld();
    const s = await beginRotation(w.io, PASS);
    await runWalk(w.io, s);
    // Another device's 409-dance win lands an MK1-sealed fin over the MK2 one.
    const body = enc('{"v":2,"cash":7}');
    w.io.store.set(
      "meta/fin",
      await seal(
        w.mk1,
        { n: "meta/fin", t: "text/plain", s: body.length },
        body,
        "meta/fin",
      ),
    );
    expect(await completeFrom(w.io, s)).toBe(true);
    await assertCompleted(w);
  });
});

describe("crash matrix", () => {
  it("survives a kill at every mutation, both before and after it applies", async () => {
    // Measure the full run's mutation count once.
    const probe = await seedWorld();
    const s0 = await beginRotation(probe.io, PASS);
    await completeFrom(probe.io, s0);
    const totalMuts = probe.io.muts;
    expect(totalMuts).toBeGreaterThan(15);

    for (const mode of ["before", "after"] as const) {
      for (let n = 0; n < totalMuts; n++) {
        const w = await seedWorld();
        const seedKs = w.io.store.get("meta/keystore")!;
        w.io.failAfter = n;
        w.io.failMode = mode;
        let crashed = false;
        try {
          const s = await beginRotation(w.io, PASS);
          await completeFrom(w.io, s);
        } catch (err) {
          if (err instanceof RotationHalt) throw err; // real bug, not the kill
          crashed = true;
        }
        expect(crashed, `kill@${mode}:${n} should crash`).toBe(true);

        // 1. The invariant holds at the moment of death…
        await assertInvariant(w.io);
        // 2. …and a fresh session finishes the rotation from exactly here.
        w.io.failAfter = Infinity;
        await driveToCompletion(w.io, seedKs);
        await assertCompleted(w);
      }
    }
  }, 120_000);
});
