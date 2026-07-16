import { describe, expect, it } from "vitest";
import { buildManifest, hashBytes, type ManifestEntry } from "./merkle";
import {
  imageBlob,
  noteBlob,
  VAULT_INDEX_PATH,
  VAULT_SEARCH_INDEX_PATH,
  type VaultIndex,
} from "./vaultblob";
import {
  checkVaultIntegrity,
  expectedVaultPaths,
  manifestHashFor,
} from "./vaultverify";

// Well-formed 22-char base64url ids (the shape deriveId emits).
const idA = "A".repeat(22);
const idB = "B".repeat(22);
const idC = "C".repeat(22);

const INDEX: VaultIndex = {
  v: 1,
  notes: [
    {
      id: idA,
      title: "2026-07-16",
      path: "journals/2026-07-16.md",
      modified: "2026-07-16T00:00:00Z",
    },
    {
      id: idB,
      title: "Project Ideas",
      path: "Project Ideas.md",
      modified: "2026-07-10T00:00:00Z",
    },
  ],
  images: [{ id: idC, name: "cat.jpg", path: "img/cat.jpg" }],
};

const INDEX_BYTES = new TextEncoder().encode("sealed-index-envelope");

/** A manifest whose entries exactly cover INDEX, with a real hash for the index
 *  envelope and dummy hashes elsewhere. */
async function manifestFor(index: VaultIndex, epoch: number) {
  const indexHash = await hashBytes(INDEX_BYTES);
  const entries: ManifestEntry[] = expectedVaultPaths(index).map((path) => ({
    path,
    h: path === VAULT_INDEX_PATH ? indexHash : `h-of-${path}`,
  }));
  return buildManifest(entries, epoch);
}

describe("expectedVaultPaths", () => {
  it("derives the index, the search index, and every note/image blob — never the manifest itself", () => {
    const paths = expectedVaultPaths(INDEX);
    expect(paths).toEqual([
      VAULT_INDEX_PATH,
      VAULT_SEARCH_INDEX_PATH,
      noteBlob(idA),
      noteBlob(idB),
      imageBlob(idC),
    ]);
    expect(paths).not.toContain("vault/manifest.bin");
  });
});

describe("manifestHashFor", () => {
  it("returns the recorded hash, or null for an unrecorded path", async () => {
    const m = await manifestFor(INDEX, 1);
    expect(manifestHashFor(m, noteBlob(idA))).toBe(`h-of-${noteBlob(idA)}`);
    expect(manifestHashFor(m, "vault/n-zzz.bin")).toBe(null);
  });
});

describe("checkVaultIntegrity", () => {
  it("verifies a consistent store and reports the epoch to persist", async () => {
    const result = await checkVaultIntegrity({
      manifest: await manifestFor(INDEX, 3),
      index: INDEX,
      indexEnvelopeHash: await hashBytes(INDEX_BYTES),
      seenEpoch: 2,
    });
    expect(result).toEqual({ status: "verified", epoch: 3, problems: [] });
  });

  it("first verification (null seenEpoch) is trusted by design", async () => {
    const result = await checkVaultIntegrity({
      manifest: await manifestFor(INDEX, 1),
      index: INDEX,
      indexEnvelopeHash: await hashBytes(INDEX_BYTES),
      seenEpoch: null,
    });
    expect(result.status).toBe("verified");
  });

  it("alarms on an index envelope that doesn't match the manifest", async () => {
    const result = await checkVaultIntegrity({
      manifest: await manifestFor(INDEX, 3),
      index: INDEX,
      indexEnvelopeHash: await hashBytes(new TextEncoder().encode("swapped")),
      seenEpoch: 3,
    });
    expect(result.status).toBe("alarm");
    expect(result.problems.join(" ")).toContain(
      "index ciphertext does not match",
    );
  });

  it("alarms on a rollback — served epoch older than the device memory", async () => {
    const result = await checkVaultIntegrity({
      manifest: await manifestFor(INDEX, 3),
      index: INDEX,
      indexEnvelopeHash: await hashBytes(INDEX_BYTES),
      seenEpoch: 5,
    });
    expect(result.status).toBe("alarm");
    expect(result.problems.join(" ")).toContain("rolled back");
    expect(result.problems.join(" ")).toContain("epoch 3");
    expect(result.problems.join(" ")).toContain("epoch 5");
  });

  it("alarms on a tampered manifest (root no longer matches its entries)", async () => {
    const m = await manifestFor(INDEX, 3);
    m.entries[1] = { ...m.entries[1], h: "edited-after-sealing" };
    const result = await checkVaultIntegrity({
      manifest: m,
      index: INDEX,
      indexEnvelopeHash: await hashBytes(INDEX_BYTES),
      seenEpoch: 3,
    });
    expect(result.status).toBe("alarm");
    expect(result.problems.join(" ")).toContain("root does not match");
  });

  it("names an index-listed blob the manifest doesn't record, by TITLE", async () => {
    const m = await manifestFor(INDEX, 3);
    const withExtra: VaultIndex = {
      ...INDEX,
      notes: [
        ...INDEX.notes,
        {
          id: "D".repeat(22),
          title: "Unrecorded Note",
          path: "Unrecorded Note.md",
          modified: "2026-07-16T00:00:00Z",
        },
      ],
    };
    const result = await checkVaultIntegrity({
      manifest: m,
      index: withExtra,
      indexEnvelopeHash: await hashBytes(INDEX_BYTES),
      seenEpoch: 3,
    });
    expect(result.status).toBe("alarm");
    expect(result.problems.join(" ")).toContain("Unrecorded Note");
  });

  it("names a recorded blob the index no longer lists (a vanished/rolled-back index)", async () => {
    const m = await manifestFor(INDEX, 3);
    const withoutB: VaultIndex = {
      ...INDEX,
      notes: INDEX.notes.filter((n) => n.id !== idB),
    };
    const result = await checkVaultIntegrity({
      manifest: m,
      index: withoutB,
      indexEnvelopeHash: await hashBytes(INDEX_BYTES),
      seenEpoch: 3,
    });
    expect(result.status).toBe("alarm");
    // The vanished note isn't in the served index, so it can only be named by
    // its stored path.
    expect(result.problems.join(" ")).toContain(noteBlob(idB));
  });

  it("alarms when the manifest doesn't record the note index at all", async () => {
    const indexHash = await hashBytes(INDEX_BYTES);
    const entries = expectedVaultPaths(INDEX)
      .filter((p) => p !== VAULT_INDEX_PATH)
      .map((path) => ({ path, h: `h-of-${path}` }));
    const result = await checkVaultIntegrity({
      manifest: await buildManifest(entries, 3),
      index: INDEX,
      indexEnvelopeHash: indexHash,
      seenEpoch: 3,
    });
    expect(result.status).toBe("alarm");
    expect(result.problems.join(" ")).toContain(
      "does not record the note index",
    );
  });

  it("caps a mass-deletion alarm instead of naming a thousand blobs", async () => {
    const m = await manifestFor(INDEX, 3);
    const many: VaultIndex = {
      ...INDEX,
      notes: [
        ...INDEX.notes,
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `${i}`.repeat(22).slice(0, 22),
          title: `Extra ${i}`,
          path: `Extra ${i}.md`,
          modified: "2026-07-16T00:00:00Z",
        })),
      ],
    };
    const result = await checkVaultIntegrity({
      manifest: m,
      index: many,
      indexEnvelopeHash: await hashBytes(INDEX_BYTES),
      seenEpoch: 3,
    });
    expect(result.status).toBe("alarm");
    expect(result.problems.join(" ")).toContain("and 3 more");
  });
});
