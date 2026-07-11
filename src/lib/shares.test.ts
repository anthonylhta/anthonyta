import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { del, get, list } from "@vercel/blob";
import { readShareStream, sweepExpiredShares } from "./shares";
import { shareSegment } from "./files";

vi.mock("@vercel/blob", () => ({ get: vi.fn(), list: vi.fn(), del: vi.fn() }));

const mockGet = vi.mocked(get);
const mockList = vi.mocked(list);
const mockDel = vi.mocked(del);

const ID22 = "mB4d5S3CkQxGxUKz2AkKfg"; // 22 chars of base64url
const ID22B = "AbCdEfGhIjKlMnOpQrStUv";

const NOW = 1_800_000_000; // epoch seconds
const FRESH = shareSegment(1_900_000_000, ID22); // expires after NOW
const EXPIRED = shareSegment(1_700_000_000, ID22); // expired before NOW

const getResult = (
  over: Partial<{ statusCode: number; stream: ReadableStream | null }>,
) =>
  ({ statusCode: 200, stream: null, ...over }) as unknown as Awaited<
    ReturnType<typeof get>
  >;

const page = (pathnames: string[], cursor?: string) =>
  ({
    blobs: pathnames.map((pathname) => ({ pathname })),
    hasMore: Boolean(cursor),
    cursor,
  }) as unknown as Awaited<ReturnType<typeof list>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readShareStream", () => {
  it("streams the ciphertext for a fresh (future-expiry) segment", async () => {
    const stream = new Response("ciphertext").body;
    mockGet.mockResolvedValue(getResult({ stream }));
    expect(await readShareStream(FRESH, NOW)).toBe(stream);
    expect(mockGet).toHaveBeenCalledWith(`share/${FRESH}.bin`, {
      access: "private",
    });
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

  it("is null on a non-200 status", async () => {
    mockGet.mockResolvedValue(getResult({ statusCode: 404, stream: null }));
    expect(await readShareStream(FRESH, NOW)).toBeNull();
  });

  it("is null on a missing blob or a throw", async () => {
    mockGet.mockResolvedValue(
      null as unknown as Awaited<ReturnType<typeof get>>,
    );
    expect(await readShareStream(FRESH, NOW)).toBeNull();
    mockGet.mockRejectedValue(new Error("network"));
    expect(await readShareStream(FRESH, NOW)).toBeNull();
  });

  it("is null when the store is off — without reading the blob", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(await readShareStream(FRESH, NOW)).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe("sweepExpiredShares", () => {
  it("dels only the expired leaves, paginating the cursor, and returns the count", async () => {
    const expired1 = `share/${shareSegment(1_700_000_000, ID22)}.bin`;
    const fresh1 = `share/${shareSegment(1_900_000_000, ID22B)}.bin`;
    const expired2 = `share/${shareSegment(1_650_000_000, ID22B)}.bin`;
    const junk = "share/leftover.json"; // not a share segment → skipped
    mockList
      .mockResolvedValueOnce(page([expired1, fresh1], "cursor-2"))
      .mockResolvedValueOnce(page([expired2, junk]));
    mockDel.mockResolvedValue(undefined);

    expect(await sweepExpiredShares(NOW)).toBe(2);
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockList).toHaveBeenLastCalledWith({
      prefix: "share/",
      cursor: "cursor-2",
    });
    expect(mockDel).toHaveBeenCalledTimes(2);
    expect(mockDel).toHaveBeenCalledWith(expired1);
    expect(mockDel).toHaveBeenCalledWith(expired2);
    expect(mockDel).not.toHaveBeenCalledWith(fresh1);
    expect(mockDel).not.toHaveBeenCalledWith(junk);
  });

  it("deletes nothing when every share is still fresh", async () => {
    mockList.mockResolvedValue(
      page([`share/${shareSegment(1_900_000_000, ID22)}.bin`]),
    );
    expect(await sweepExpiredShares(NOW)).toBe(0);
    expect(mockDel).not.toHaveBeenCalled();
  });

  it("returns 0 when the store is off, without listing", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(await sweepExpiredShares(NOW)).toBe(0);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("never throws — a failed list returns the count so far", async () => {
    mockList.mockRejectedValue(new Error("list boom"));
    expect(await sweepExpiredShares(NOW)).toBe(0);
  });
});
