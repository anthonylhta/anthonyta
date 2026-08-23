import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseShareSegment } from "@/lib/files";
import { pushAfter } from "@/lib/pushsend";
import { readShareStream } from "@/lib/shares";
import { GET } from "./route";

// The public share route touches three collaborators: `parseShareSegment` (the
// segment gate), `readShareStream` (the ONLY, share-scoped, blob touch), and
// `pushAfter` (fire-and-forget, post-response, no bearing on what is served).
// Neither `@/auth` nor any inbox/meta reader is imported — a guest reaching a valid
// share is by design, so there is nothing to gate here.
vi.mock("@/lib/files", () => ({ parseShareSegment: vi.fn() }));
vi.mock("@/lib/shares", () => ({ readShareStream: vi.fn() }));
vi.mock("@/lib/pushsend", () => ({ pushAfter: vi.fn() }));

const VALID_ID = "9999999999-e-AAAAAAAAAAAAAAAAAAAAAA";

function call(id: string) {
  return GET(new Request("http://localhost/api/share/x"), {
    params: Promise.resolve({ id }),
  });
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

describe("public share route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("streams ciphertext for a valid, unexpired id — 200, octet-stream, no-store, to a GUEST", async () => {
    // No session is mocked and none is consulted: this returning 200 proves the
    // route is public by design (no owner gate).
    vi.mocked(parseShareSegment).mockReturnValue({ expiry: 9999999999 });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.mocked(readShareStream).mockResolvedValue(streamOf(bytes));

    const res = await call(VALID_ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    // The bytes pass straight through, unbuffered.
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("hands the raw id to the share-scoped reader as its only store touch, and builds no other path", async () => {
    vi.mocked(parseShareSegment).mockReturnValue({ expiry: 9999999999 });
    vi.mocked(readShareStream).mockResolvedValue(null);

    // Even if the gate is forced to accept a hostile-looking segment, the route's
    // sole blob interaction is readShareStream(id) — which is share-scoped
    // (`share/<id>.bin`). The route never constructs an inbox/meta/vault key, so
    // those bytes are structurally unreachable from here.
    await call("meta/keystore");
    expect(readShareStream).toHaveBeenCalledTimes(1);
    const [seg, now] = vi.mocked(readShareStream).mock.calls[0];
    expect(seg).toBe("meta/keystore");
    expect(typeof now).toBe("number");
  });

  it("404s a malformed id without touching the store", async () => {
    vi.mocked(parseShareSegment).mockReturnValue(null);

    const res = await call("not-a-share-id");
    expect(res.status).toBe(404);
    expect(readShareStream).not.toHaveBeenCalled();
  });

  it("404s a traversal id — parseShareSegment rejects it before any store read", async () => {
    vi.mocked(parseShareSegment).mockReturnValue(null);

    const res = await call("../meta/keystore");
    expect(res.status).toBe(404);
    expect(readShareStream).not.toHaveBeenCalled();
  });

  it("404s when readShareStream returns null (expired or absent) — no oracle", async () => {
    vi.mocked(parseShareSegment).mockReturnValue({ expiry: 9999999999 });
    vi.mocked(readShareStream).mockResolvedValue(null);

    const res = await call(VALID_ID);
    expect(res.status).toBe(404);
  });

  it("buzzes the owner on a real collection, with a line that names nothing", async () => {
    vi.mocked(parseShareSegment).mockReturnValue({ expiry: 9999999999 });
    vi.mocked(readShareStream).mockResolvedValue(streamOf(new Uint8Array([1])));

    await call(VALID_ID);
    expect(pushAfter).toHaveBeenCalledTimes(1);
    const [category, body, url] = vi.mocked(pushAfter).mock.calls[0];
    expect(category).toBe("share");
    expect(url).toBe("/files");
    // Contentless: the id (and so the file behind it) never reaches a lock screen.
    expect(body).not.toContain(VALID_ID);
  });

  it("buzzes again on a second collection — a repeat IS the leak signal", async () => {
    vi.mocked(parseShareSegment).mockReturnValue({ expiry: 9999999999 });
    vi.mocked(readShareStream).mockResolvedValue(streamOf(new Uint8Array([1])));

    await call(VALID_ID);
    await call(VALID_ID);
    expect(pushAfter).toHaveBeenCalledTimes(2);
  });

  it("stays silent on every rejection — a probe must not be able to buzz the phone", async () => {
    vi.mocked(parseShareSegment).mockReturnValue(null);
    await call("not-a-share-id");

    vi.mocked(parseShareSegment).mockReturnValue({ expiry: 9999999999 });
    vi.mocked(readShareStream).mockResolvedValue(null);
    await call(VALID_ID);

    expect(pushAfter).not.toHaveBeenCalled();
  });
});
