import { afterEach, describe, expect, it, vi } from "vitest";
import { generateMk, seal } from "./crypto";
import { buildIndex, serializeIndex, type IndexDoc } from "./searchidx";
import type { VaultIndex, VaultIndexNote } from "./vaultblob";
import {
  loadNoteIndex,
  loadNoteSearch,
  loadSearchIndex,
  noteMap,
  titledHits,
} from "./vaultquery";

const DOCS: IndexDoc[] = [
  { id: "aaa", title: "2026-08-20 daily", text: "gym, then the transit fix" },
  { id: "bbb", title: "transit notes", text: "the stop finder is unranked" },
  { id: "ccc", title: "日本語のノート", text: "trigrams need no dictionary" },
];

const NOTES: VaultIndexNote[] = [
  {
    id: "aaa",
    title: "2026-08-20 daily",
    path: "journals/2026-08-20.md",
    modified: "2026-08-20T09:00:00Z",
    preview: "gym, then the transit fix",
  },
  {
    id: "bbb",
    title: "transit notes",
    path: "notes/transit.md",
    modified: "2026-08-19T09:00:00Z",
  },
  {
    id: "ccc",
    title: "日本語のノート",
    path: "notes/jp.md",
    modified: "2026-08-18T09:00:00Z",
  },
];

const INDEX = buildIndex(DOCS);

/** The openItem the vault hook hands in — identity here, so the loaders can be
 *  tested without crypto (the sealed round trip gets its own test below). */
const passthrough = async (envelope: Uint8Array) => ({ bytes: envelope });

function stubFetch(reply: (url: string) => Response | Promise<Response>): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
    Promise.resolve(reply(String(input))),
  );
}

function bytesResponse(bytes: Uint8Array): Response {
  return new Response(bytes as BufferSource, { status: 200 });
}

function indexJsonBytes(notes: VaultIndexNote[]): Uint8Array {
  const index: VaultIndex = { v: 1, notes, images: [] };
  return new TextEncoder().encode(JSON.stringify(index));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// the pure join
// ---------------------------------------------------------------------------

describe("noteMap", () => {
  it("keys notes by id", () => {
    const map = noteMap(NOTES);
    expect(map.size).toBe(3);
    expect(map.get("bbb")?.title).toBe("transit notes");
  });

  it("keeps the FIRST of a duplicated id — the index is newest-first", () => {
    const older: VaultIndexNote = { ...NOTES[0], title: "an older copy" };
    expect(noteMap([NOTES[0], older]).get("aaa")?.title).toBe(
      "2026-08-20 daily",
    );
  });

  it("handles an empty index", () => {
    expect(noteMap([]).size).toBe(0);
  });
});

describe("titledHits", () => {
  const byId = noteMap(NOTES);

  it("dresses each hit with its title and preview", () => {
    const hits = titledHits(INDEX, byId, "transit", 5);
    expect(hits.map((h) => h.noteId).sort()).toEqual(["aaa", "bbb"]);
    const daily = hits.find((h) => h.noteId === "aaa")!;
    expect(daily.title).toBe("2026-08-20 daily");
    expect(daily.preview).toBe("gym, then the transit fix");
  });

  it("ranks a title match above a body-only one", () => {
    expect(titledHits(INDEX, byId, "transit", 5)[0].noteId).toBe("bbb");
  });

  it("falls back to the id (and an empty preview) for a note the index doesn't know", () => {
    const hits = titledHits(INDEX, noteMap([]), "transit", 5);
    expect(hits[0]).toEqual({ noteId: "bbb", title: "bbb", preview: "" });
  });

  it("leaves a note without a preview with an empty one", () => {
    expect(titledHits(INDEX, byId, "stop finder", 5)[0].preview).toBe("");
  });

  it("honours k", () => {
    expect(titledHits(INDEX, byId, "transit", 1)).toHaveLength(1);
  });

  it("matches 日本語 by substring, the same mechanism", () => {
    expect(titledHits(INDEX, byId, "ノート", 5).map((h) => h.noteId)).toEqual([
      "ccc",
    ]);
  });

  it("returns nothing for a query no note contains", () => {
    expect(titledHits(INDEX, byId, "kubernetes", 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the loaders — every miss is a labelled string, never a throw
// ---------------------------------------------------------------------------

describe("loadSearchIndex", () => {
  it("fetches the sealed leaf through the owner-gated raw route", async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return bytesResponse(serializeIndex(INDEX));
    });
    const loaded = await loadSearchIndex(passthrough);
    expect(typeof loaded).not.toBe("string");
    expect(seen).toEqual([
      "/api/vault/raw?p=" + encodeURIComponent("vault/search-index.bin"),
    ]);
  });

  it("parses the index back into something queryable", async () => {
    stubFetch(() => bytesResponse(serializeIndex(INDEX)));
    const loaded = await loadSearchIndex(passthrough);
    if (typeof loaded === "string") throw new Error("expected an index");
    expect(titledHits(loaded, noteMap(NOTES), "transit", 5)).toHaveLength(2);
  });

  it("reads a clean 404 as noindex — vault-sync hasn't written it yet", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    expect(await loadSearchIndex(passthrough)).toBe("noindex");
  });

  it("reads any other status as unreachable", async () => {
    stubFetch(() => new Response(null, { status: 503 }));
    expect(await loadSearchIndex(passthrough)).toBe("unreachable");
  });

  it("reads a network throw as unreachable, never as absent", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    expect(await loadSearchIndex(passthrough)).toBe("unreachable");
  });

  it("reads a fetched-but-unparseable blob as tamper", async () => {
    stubFetch(() => bytesResponse(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
    expect(await loadSearchIndex(passthrough)).toBe("tamper");
  });

  it("reads a failed decrypt as tamper", async () => {
    stubFetch(() => bytesResponse(serializeIndex(INDEX)));
    const wrongKey = async () => {
      throw new Error("cannot decrypt");
    };
    expect(await loadSearchIndex(wrongKey)).toBe("tamper");
  });
});

describe("loadNoteIndex", () => {
  it("returns the decrypted notes", async () => {
    stubFetch(() => bytesResponse(indexJsonBytes(NOTES)));
    expect(await loadNoteIndex(passthrough)).toEqual(NOTES);
  });

  it("reads a 404 as noindex and a hiccup as unreachable", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    expect(await loadNoteIndex(passthrough)).toBe("noindex");
    stubFetch(() => new Response(null, { status: 500 }));
    expect(await loadNoteIndex(passthrough)).toBe("unreachable");
  });

  it("reads a wrong-shaped index as tamper rather than as an empty vault", async () => {
    stubFetch(() =>
      bytesResponse(new TextEncoder().encode('{"v":1,"notes":"nope"}')),
    );
    expect(await loadNoteIndex(passthrough)).toBe("tamper");
  });
});

// ---------------------------------------------------------------------------
// the palette's one-shot load — real envelopes, real key
// ---------------------------------------------------------------------------

describe("loadNoteSearch", () => {
  async function sealedStore(mk: CryptoKey) {
    const search = await seal(
      mk,
      { n: "search-index", t: "application/octet-stream", s: 0 },
      serializeIndex(INDEX),
    );
    const notes = await seal(
      mk,
      { n: "index", t: "application/json", s: 0 },
      indexJsonBytes(NOTES),
    );
    return { search, notes };
  }

  it("opens both sealed indexes and answers queries in memory", async () => {
    const mk = await generateMk();
    const store = await sealedStore(mk);
    stubFetch((url) =>
      bytesResponse(url.includes("search-index") ? store.search : store.notes),
    );

    const search = await loadNoteSearch(mk);
    expect(search).not.toBeNull();
    expect(search!("transit", 5).map((h) => h.title)).toEqual([
      "transit notes",
      "2026-08-20 daily",
    ]);
  });

  it("is null when either leaf is missing — one degraded mode, silence", async () => {
    const mk = await generateMk();
    const store = await sealedStore(mk);
    stubFetch((url) =>
      url.includes("search-index")
        ? new Response(null, { status: 404 })
        : bytesResponse(store.notes),
    );
    expect(await loadNoteSearch(mk)).toBeNull();
  });

  it("is null under a key that can't open the envelopes", async () => {
    const mk = await generateMk();
    const store = await sealedStore(mk);
    stubFetch((url) =>
      bytesResponse(url.includes("search-index") ? store.search : store.notes),
    );
    expect(await loadNoteSearch(await generateMk())).toBeNull();
  });
});
