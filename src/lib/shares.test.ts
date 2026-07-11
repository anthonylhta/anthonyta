import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { r2Delete, r2Get, r2List } from "./r2";
import { readShareStream, sweepExpiredShares } from "./shares";
import { shareSegment } from "./files";

vi.mock("./r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2")>()),
  r2Get: vi.fn(),
  r2List: vi.fn(),
  r2Delete: vi.fn(),
}));

const mockGet = vi.mocked(r2Get);
const mockList = vi.mocked(r2List);
const mockDelete = vi.mocked(r2Delete);

const ID22 = "mB4d5S3CkQxGxUKz2AkKfg"; // 22 chars of base64url
const ID22B = "AbCdEfGhIjKlMnOpQrStUv";

const NOW = 1_800_000_000; // epoch seconds
const FRESH = shareSegment(1_900_000_000, ID22); // expires after NOW
const EXPIRED = shareSegment(1_700_000_000, ID22); // expired before NOW

const stubR2Env = () => {
  vi.stubEnv("R2_ACCOUNT_ID", "acct123");
  vi.stubEnv("R2_ACCESS_KEY_ID", "AKIDEXAMPLE");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET", "hub");
};

const page = (keys: string[], next?: string) => ({
  objects: keys.map((key) => ({ key, size: 1, lastModified: "" })),
  next,
});

beforeEach(() => {
  vi.clearAllMocks();
  stubR2Env();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readShareStream", () => {
  it("streams the ciphertext for a fresh (future-expiry) segment", async () => {
    const res = new Response("ciphertext");
    const body = res.body;
    mockGet.mockResolvedValue(res);
    expect(await readShareStream(FRESH, NOW)).toBe(body);
    expect(mockGet).toHaveBeenCalledWith(`share/${FRESH}.bin`);
  });

  it("is null for an expired segment — without ever reading the blob", async () => {
    expect(await readShareStream(EXPIRED, NOW)).toBeNull();
    // an expiry exactly at now has lapsed too (<=)
    expect(await readShareStream(shareSegment(NOW, ID22), NOW)).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("is null for a malformed segment — without reading the blob", async () => {
    expect(await readShareStream("not-a-segment", NOW)).toBeNull();
    expect(await readShareStream(`${FRESH}.bin`, NOW)).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("is null on a non-200 status and on a throw", async () => {
    mockGet.mockResolvedValue(new Response("gone", { status: 404 }));
    expect(await readShareStream(FRESH, NOW)).toBeNull();
    mockGet.mockRejectedValue(new Error("network"));
    expect(await readShareStream(FRESH, NOW)).toBeNull();
  });

  it("is null when the store is off — without reading the blob", async () => {
    vi.stubEnv("R2_BUCKET", "");
    expect(await readShareStream(FRESH, NOW)).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("sweepExpiredShares", () => {
  it("deletes only the expired leaves, paginating the token, and returns the count", async () => {
    const expired1 = `share/${shareSegment(1_700_000_000, ID22)}.bin`;
    const fresh1 = `share/${shareSegment(1_900_000_000, ID22B)}.bin`;
    const expired2 = `share/${shareSegment(1_650_000_000, ID22B)}.bin`;
    const junk = "share/leftover.json"; // not a share segment → skipped
    mockList
      .mockResolvedValueOnce(page([expired1, fresh1], "token-2"))
      .mockResolvedValueOnce(page([expired2, junk]));
    mockDelete.mockResolvedValue(new Response(null, { status: 204 }));

    expect(await sweepExpiredShares(NOW)).toBe(2);
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockList).toHaveBeenLastCalledWith("share/", "token-2");
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledWith(expired1);
    expect(mockDelete).toHaveBeenCalledWith(expired2);
    expect(mockDelete).not.toHaveBeenCalledWith(fresh1);
    expect(mockDelete).not.toHaveBeenCalledWith(junk);
  });

  it("deletes nothing when every share is still fresh", async () => {
    mockList.mockResolvedValue(
      page([`share/${shareSegment(1_900_000_000, ID22)}.bin`]),
    );
    expect(await sweepExpiredShares(NOW)).toBe(0);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 0 when the store is off, without listing", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "");
    expect(await sweepExpiredShares(NOW)).toBe(0);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("never throws — a failed list returns the count so far", async () => {
    mockList.mockRejectedValue(new Error("list boom"));
    expect(await sweepExpiredShares(NOW)).toBe(0);
  });
});
