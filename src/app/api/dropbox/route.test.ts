import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toB64url } from "@/lib/crypto";
import { putDrop } from "@/lib/dropstore";
import { verify } from "@/lib/pow";
import { POST } from "./route";

vi.mock("@/lib/dropstore", () => ({ putDrop: vi.fn() }));
vi.mock("@/lib/pow", () => ({ POW_BITS: 20, verify: vi.fn() }));

const ENVELOPE = toB64url(new Uint8Array([65, 83, 66, 49, 1, 2, 3, 4]));

/** Distinct IP per call keeps the module-level rate window from bleeding across tests. */
let ipSeq = 0;
function post(body: unknown, ip = `10.0.0.${++ipSeq}`) {
  return POST(
    new Request("http://localhost/api/dropbox", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verify).mockResolvedValue(true);
  vi.mocked(putDrop).mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dropbox ingest route", () => {
  it("stores a valid, proof-carrying envelope at a fresh random path", async () => {
    const res = await post({ envelope_b64: ENVELOPE, nonce: 7 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [path, bytes] = vi.mocked(putDrop).mock.calls[0];
    expect(path).toMatch(/^dropbox\/[A-Za-z0-9_-]{1,64}\.bin$/);
    expect(bytes).toEqual(new Uint8Array([65, 83, 66, 49, 1, 2, 3, 4]));
  });

  it("400s a failed proof-of-work with no oracle, and never writes", async () => {
    vi.mocked(verify).mockResolvedValue(false);
    const res = await post({ envelope_b64: ENVELOPE, nonce: 0 });
    expect(res.status).toBe(400);
    expect(putDrop).not.toHaveBeenCalled();
  });

  it("400s an oversize envelope before spending a hash", async () => {
    const big = toB64url(new Uint8Array(9000));
    const res = await post({ envelope_b64: big, nonce: 1 });
    expect(res.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
    expect(putDrop).not.toHaveBeenCalled();
  });

  it("400s a malformed body", async () => {
    expect((await post({ nonce: 1 })).status).toBe(400);
    expect((await post({ envelope_b64: 123, nonce: 1 })).status).toBe(400);
    expect((await post({ envelope_b64: ENVELOPE })).status).toBe(400);
    expect((await post(null)).status).toBe(400);
    expect(putDrop).not.toHaveBeenCalled();
  });

  it("503s (never crashes) when the store is off", async () => {
    vi.mocked(putDrop).mockResolvedValue(false);
    expect((await post({ envelope_b64: ENVELOPE, nonce: 3 })).status).toBe(503);
  });

  it("429s once the per-IP window is exceeded", async () => {
    const ip = "203.0.113.9";
    let last = 0;
    for (let i = 0; i < 7; i++) {
      last = (await post({ envelope_b64: ENVELOPE, nonce: i }, ip)).status;
    }
    expect(last).toBe(429);
  });
});
