import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DROPBOX_KEY_PATH, type DropboxKey } from "./dropbox";
import {
  deleteDrop,
  getDropboxKey,
  listDrops,
  putDrop,
  putDropboxKey,
  readDrop,
} from "./dropstore";
import {
  r2Delete,
  r2Enabled,
  r2Get,
  r2List,
  r2Put,
  readKey,
  writeKey,
} from "./r2";

vi.mock("./r2", () => ({
  r2Enabled: vi.fn(),
  r2Get: vi.fn(),
  r2Put: vi.fn(),
  r2Delete: vi.fn(),
  r2List: vi.fn(),
  readKey: vi.fn(),
  writeKey: vi.fn(),
}));

const VALID_KEY: DropboxKey = {
  v: 1,
  alg: "ECDH-P256",
  pub_b64: "AAAA",
  sealed_priv_b64: "BBBB",
};

const VALID_PATH = `dropbox/${"A".repeat(22)}.bin`;

function okRead(json: string) {
  return { state: "ok" as const, value: new TextEncoder().encode(json) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(r2Enabled).mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getDropboxKey", () => {
  it("parses a valid stored record", async () => {
    vi.mocked(readKey).mockResolvedValue(okRead(JSON.stringify(VALID_KEY)));
    expect(await getDropboxKey()).toEqual({ state: "ok", value: VALID_KEY });
  });

  it("passes absent through untouched (first-run signal)", async () => {
    vi.mocked(readKey).mockResolvedValue({ state: "absent" });
    expect(await getDropboxKey()).toEqual({ state: "absent" });
  });

  it("passes a store error through — never masquerades as absent", async () => {
    vi.mocked(readKey).mockResolvedValue({ state: "error" });
    expect(await getDropboxKey()).toEqual({ state: "error" });
  });

  it("reports a corrupt / unparseable blob as error, not absent", async () => {
    vi.mocked(readKey).mockResolvedValue(okRead("not json{"));
    expect(await getDropboxKey()).toEqual({ state: "error" });
  });

  it("reports a wrong-shape blob as error", async () => {
    vi.mocked(readKey).mockResolvedValue(okRead(JSON.stringify({ v: 2 })));
    expect(await getDropboxKey()).toEqual({ state: "error" });
  });
});

describe("putDropboxKey", () => {
  it("writes the JSON record at the fixed path with the overwrite flag", async () => {
    vi.mocked(writeKey).mockResolvedValue("ok");
    expect(await putDropboxKey(VALID_KEY, false)).toBe("ok");
    expect(writeKey).toHaveBeenCalledWith(
      DROPBOX_KEY_PATH,
      JSON.stringify(VALID_KEY),
      { overwrite: false, contentType: "application/json" },
    );
  });
});

describe("putDrop", () => {
  it("writes a valid path through to the store", async () => {
    vi.mocked(r2Put).mockResolvedValue(new Response(null, { status: 200 }));
    expect(await putDrop(VALID_PATH, new Uint8Array([1, 2, 3]))).toBe(true);
    expect(r2Put).toHaveBeenCalledOnce();
  });

  it("refuses a malformed path without touching the store", async () => {
    expect(await putDrop("dropbox/../meta/keystore", new Uint8Array())).toBe(
      false,
    );
    expect(await putDrop("meta/keystore", new Uint8Array())).toBe(false);
    expect(r2Put).not.toHaveBeenCalled();
  });

  it("no-ops when the store is off", async () => {
    vi.mocked(r2Enabled).mockReturnValue(false);
    expect(await putDrop(VALID_PATH, new Uint8Array([1]))).toBe(false);
    expect(r2Put).not.toHaveBeenCalled();
  });
});

describe("readDrop", () => {
  it("returns the bytes for a valid path", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    vi.mocked(r2Get).mockResolvedValue(new Response(bytes, { status: 200 }));
    expect(await readDrop(VALID_PATH)).toEqual(bytes);
  });

  it("refuses a malformed path without touching the store", async () => {
    expect(await readDrop("dropbox/../meta/keystore")).toBeNull();
    expect(r2Get).not.toHaveBeenCalled();
  });

  it("returns null on a missing blob or a store that's off", async () => {
    vi.mocked(r2Get).mockResolvedValue(new Response(null, { status: 404 }));
    expect(await readDrop(VALID_PATH)).toBeNull();
    vi.mocked(r2Enabled).mockReturnValue(false);
    expect(await readDrop(VALID_PATH)).toBeNull();
  });
});

describe("deleteDrop", () => {
  it("deletes a valid path", async () => {
    vi.mocked(r2Delete).mockResolvedValue(new Response(null, { status: 204 }));
    expect(await deleteDrop(VALID_PATH)).toBe(true);
    expect(r2Delete).toHaveBeenCalledOnce();
  });

  it("refuses a malformed path without touching the store", async () => {
    expect(await deleteDrop("dropbox/../meta/keystore")).toBe(false);
    expect(r2Delete).not.toHaveBeenCalled();
  });

  it("no-ops when the store is off", async () => {
    vi.mocked(r2Enabled).mockReturnValue(false);
    expect(await deleteDrop(VALID_PATH)).toBe(false);
    expect(r2Delete).not.toHaveBeenCalled();
  });
});

describe("listDrops", () => {
  it("walks every page under the prefix", async () => {
    vi.mocked(r2List)
      .mockResolvedValueOnce({
        objects: [{ key: "dropbox/a.bin", size: 1, lastModified: "t1" }],
        next: "tok",
      })
      .mockResolvedValueOnce({
        objects: [{ key: "dropbox/b.bin", size: 2, lastModified: "t2" }],
      });
    const { objects, offline } = await listDrops();
    expect(offline).toBe(false);
    expect(objects.map((o) => o.key)).toEqual([
      "dropbox/a.bin",
      "dropbox/b.bin",
    ]);
  });

  it("degrades to an empty, offline listing when the store is off", async () => {
    vi.mocked(r2Enabled).mockReturnValue(false);
    expect(await listDrops()).toEqual({ objects: [], offline: true });
    expect(r2List).not.toHaveBeenCalled();
  });

  it("degrades to offline when a list throws — never a partial truth", async () => {
    vi.mocked(r2List).mockRejectedValue(new Error("boom"));
    expect(await listDrops()).toEqual({ objects: [], offline: true });
  });
});
