import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvelopeMeta } from "@/lib/crypto";
import type { InboxFile } from "@/lib/files";
import { saveAllImages } from "./saveAll";

/** A folder that records what was written into it. */
function fakeDir(existing: string[] = []) {
  const written = new Map<string, Blob>();
  const dir = {
    name: "photos-inbox",
    async getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!opts?.create && !existing.includes(name) && !written.has(name))
        throw new Error("NotFoundError");
      return {
        async createWritable() {
          return {
            async write(blob: Blob) {
              written.set(name, blob);
            },
            async close() {},
          };
        },
      };
    },
  };
  return { dir, written };
}

function row(pathname: string, encrypted = true): InboxFile {
  return {
    pathname,
    name: pathname,
    size: 1,
    uploadedAt: "2026-09-17T00:00:00Z",
    kind: "other",
    encrypted,
  };
}

// The "envelope" is just the row's pathname; openItem looks its meta up by it.
function stubFetch(broken: string[] = []) {
  vi.stubGlobal("fetch", async (url: string) => {
    const p = decodeURIComponent(url.split("p=")[1]);
    return {
      ok: !broken.includes(p),
      arrayBuffer: async () => new TextEncoder().encode(p).buffer,
    };
  });
}

function opener(metas: Record<string, EnvelopeMeta>) {
  return async (envelope: Uint8Array) => ({
    meta: metas[new TextDecoder().decode(envelope)],
    bytes: new Uint8Array([1, 2, 3]),
  });
}

const isImage = (m: EnvelopeMeta) => m.t.startsWith("image/");

afterEach(() => vi.unstubAllGlobals());

describe("saveAllImages", () => {
  it("writes the images into the picked folder and leaves the rest", async () => {
    const { dir, written } = fakeDir();
    vi.stubGlobal("window", { showDirectoryPicker: async () => dir });
    stubFetch();
    const progress: string[] = [];
    const result = await saveAllImages(
      [row("inbox/a"), row("inbox/note"), row("inbox/plain", false)],
      opener({
        "inbox/a": { n: "IMG_1.jpg", t: "image/jpeg", s: 3 },
        "inbox/note": { n: "note.txt", t: "text/plain", s: 3 },
      }),
      isImage,
      (done, total) => progress.push(`${done}/${total}`),
    );
    expect(result).toEqual({
      saved: ["inbox/a"],
      failed: 0,
      folder: "photos-inbox",
    });
    expect([...written.keys()]).toEqual(["IMG_1.jpg"]);
    expect(progress).toEqual(["0/2", "1/2"]);
  });

  it("never writes over a file the folder already holds, or its own", async () => {
    const { dir, written } = fakeDir(["IMG_1.jpg"]);
    vi.stubGlobal("window", { showDirectoryPicker: async () => dir });
    stubFetch();
    const result = await saveAllImages(
      [row("inbox/a"), row("inbox/b")],
      opener({
        "inbox/a": { n: "IMG_1.jpg", t: "image/jpeg", s: 3 },
        "inbox/b": { n: "IMG_1.jpg", t: "image/jpeg", s: 3 },
      }),
      isImage,
      () => {},
    );
    expect(result?.saved).toEqual(["inbox/a", "inbox/b"]);
    expect([...written.keys()]).toEqual(["IMG_1 (1).jpg", "IMG_1 (2).jpg"]);
  });

  it("counts a row that can't be fetched and carries on", async () => {
    const { dir, written } = fakeDir();
    vi.stubGlobal("window", { showDirectoryPicker: async () => dir });
    stubFetch(["inbox/a"]);
    const result = await saveAllImages(
      [row("inbox/a"), row("inbox/b")],
      opener({ "inbox/b": { n: "b.png", t: "image/png", s: 3 } }),
      isImage,
      () => {},
    );
    expect(result).toEqual({
      saved: ["inbox/b"],
      failed: 1,
      folder: "photos-inbox",
    });
    expect([...written.keys()]).toEqual(["b.png"]);
  });

  it("resolves null when the picker is dismissed, before fetching anything", async () => {
    vi.stubGlobal("window", {
      showDirectoryPicker: async () => {
        throw new Error("AbortError");
      },
    });
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    expect(
      await saveAllImages([row("inbox/a")], opener({}), isImage, () => {}),
    ).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });
});
