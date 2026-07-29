import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { r2Enabled, r2List, readKey } from "@/lib/r2";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/r2", () => ({
  r2Enabled: vi.fn(),
  r2List: vi.fn(),
  readKey: vi.fn(),
}));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/aperture/hist${query}`));
}

/** A frame-valid AEV2 envelope: 4 magic bytes + deterministic filler. Invented
 *  bytes — the route never decrypts, so the contents only have to be stable. */
function envelope(totalLen = 40): Uint8Array {
  const out = new Uint8Array(totalLen);
  out.set(new TextEncoder().encode("AEV2"), 0);
  for (let i = 4; i < totalLen; i++) out[i] = (i * 7 + 3) % 256;
  return out;
}

describe("aperture hist route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { name: "owner" } });
    vi.mocked(r2Enabled).mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("404s a guest without touching the store, listing or day alike", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect((await get("?d=2026-07-26")).status).toBe(404);
    expect(r2List).not.toHaveBeenCalled();
    expect(readKey).not.toHaveBeenCalled();
  });

  it("404s a malformed day without touching the store", async () => {
    for (const d of [
      "2026-7-26", // unpadded
      "26-07-26", // two-digit year
      "latest",
      "2026-07-26.bin", // a key, not a day
      "..%2Fkeystore", // traversal-shaped
    ])
      expect((await get(`?d=${d}`)).status, d).toBe(404);
    expect(readKey).not.toHaveBeenCalled();
  });

  it("serves a day's envelope bytes, uncacheable, from its dated key", async () => {
    const bytes = envelope(48);
    vi.mocked(readKey).mockResolvedValue({ state: "ok", value: bytes });
    const res = await get("?d=2026-07-26");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(readKey).toHaveBeenCalledWith("meta/aperture-hist/2026-07-26.bin");
  });

  it("404s a day that was never archived", async () => {
    vi.mocked(readKey).mockResolvedValue({ state: "absent" });
    expect((await get("?d=2026-07-26")).status).toBe(404);
  });

  it("503s a flaky day read — NEVER the absent-signalling 404", async () => {
    vi.mocked(readKey).mockResolvedValue({ state: "error" });
    expect((await get("?d=2026-07-26")).status).toBe(503);
  });

  it("lists the archived days newest-first, dropping malformed keys", async () => {
    vi.mocked(r2List).mockResolvedValue({
      objects: [
        { key: "meta/aperture-hist/2026-07-05.bin", size: 1, lastModified: "" },
        { key: "meta/aperture-hist/2026-07-26.bin", size: 1, lastModified: "" },
        { key: "meta/aperture-hist/stray.txt", size: 1, lastModified: "" },
      ],
    });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      v: 1,
      days: ["2026-07-26", "2026-07-05"],
    });
  });

  it("walks every listing page before answering", async () => {
    vi.mocked(r2List)
      .mockResolvedValueOnce({
        objects: [
          {
            key: "meta/aperture-hist/2026-07-05.bin",
            size: 1,
            lastModified: "",
          },
        ],
        next: "more",
      })
      .mockResolvedValueOnce({
        objects: [
          {
            key: "meta/aperture-hist/2026-07-26.bin",
            size: 1,
            lastModified: "",
          },
        ],
      });
    expect(await (await get()).json()).toEqual({
      v: 1,
      days: ["2026-07-26", "2026-07-05"],
    });
    expect(r2List).toHaveBeenCalledTimes(2);
  });

  it("an empty history lists as an honest empty, not an error", async () => {
    vi.mocked(r2List).mockResolvedValue({ objects: [] });
    expect(await (await get()).json()).toEqual({ v: 1, days: [] });
  });

  it("503s when the listing itself fails — a dead store is not an empty one", async () => {
    vi.mocked(r2List).mockRejectedValue(new Error("HTTP 500"));
    expect((await get()).status).toBe(503);
  });

  it("503s the listing when the store is off entirely", async () => {
    vi.mocked(r2Enabled).mockReturnValue(false);
    expect((await get()).status).toBe(503);
    expect(r2List).not.toHaveBeenCalled();
  });
});
