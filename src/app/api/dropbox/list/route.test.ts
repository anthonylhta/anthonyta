import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { toB64url } from "@/lib/crypto";
import { listDrops, readDrop } from "@/lib/dropstore";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/dropstore", () => ({
  listDrops: vi.fn(),
  readDrop: vi.fn(),
}));

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { name: "owner" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dropbox/list route", () => {
  it("404s a guest without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    expect(listDrops).not.toHaveBeenCalled();
  });

  it("inlines each envelope's ciphertext as base64 alongside its metadata", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.mocked(listDrops).mockResolvedValue({
      objects: [{ key: "dropbox/a.bin", size: 4, lastModified: "t1" }],
      offline: false,
    });
    vi.mocked(readDrop).mockResolvedValue(bytes);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      drops: [
        {
          key: "dropbox/a.bin",
          size: 4,
          at: "t1",
          envelope_b64: toB64url(bytes),
        },
      ],
    });
  });

  it("skips a row whose bytes won't fetch rather than sinking the listing", async () => {
    vi.mocked(listDrops).mockResolvedValue({
      objects: [
        { key: "dropbox/a.bin", size: 4, lastModified: "t1" },
        { key: "dropbox/b.bin", size: 4, lastModified: "t2" },
      ],
      offline: false,
    });
    vi.mocked(readDrop)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Uint8Array([9]));
    const { drops } = await (await GET()).json();
    expect(drops.map((d: { key: string }) => d.key)).toEqual(["dropbox/b.bin"]);
  });

  it("returns an empty listing when the store is off", async () => {
    vi.mocked(listDrops).mockResolvedValue({ objects: [], offline: true });
    expect(await (await GET()).json()).toEqual({ drops: [] });
  });
});
