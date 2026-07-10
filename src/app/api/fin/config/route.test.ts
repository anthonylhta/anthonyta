import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { FIN_MAX_BYTES } from "@/lib/fin";
import { getFinConfig, putFinConfig } from "@/lib/finstore";
import { GET, PUT } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/finstore", () => ({
  getFinConfig: vi.fn(),
  putFinConfig: vi.fn(),
}));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

/** A frame-valid AEV1 envelope: 4 magic bytes + deterministic filler. */
function envelope(totalLen = 40, magic = "AEV1"): Uint8Array {
  const out = new Uint8Array(totalLen);
  out.set(new TextEncoder().encode(magic).subarray(0, 4), 0);
  for (let i = 4; i < totalLen; i++) out[i] = (i * 7 + 3) % 256;
  return out;
}

function putReq(body: Uint8Array, headers?: Record<string, string>) {
  // BodyInit rejects a generic Uint8Array under strict TS — hand it the buffer.
  return PUT(
    new Request("http://localhost/api/fin/config", {
      method: "PUT",
      headers,
      body: body.slice().buffer as ArrayBuffer,
    }),
  );
}

describe("fin/config route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { name: "owner" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("404s a guest on GET without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    expect(getFinConfig).not.toHaveBeenCalled();
  });

  it("404s a guest on PUT without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await putReq(envelope())).status).toBe(404);
    expect(putFinConfig).not.toHaveBeenCalled();
  });

  it("GET returns the stored envelope bytes, uncacheable", async () => {
    const bytes = envelope(48);
    vi.mocked(getFinConfig).mockResolvedValue({ state: "ok", value: bytes });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("GET 404s when no config exists yet (first-run setup signal)", async () => {
    vi.mocked(getFinConfig).mockResolvedValue({ state: "absent" });
    expect((await GET()).status).toBe(404);
  });

  it("GET 503s a transient store failure — NEVER the setup-triggering 404", async () => {
    vi.mocked(getFinConfig).mockResolvedValue({ state: "error" });
    expect((await GET()).status).toBe(503);
  });

  it("PUT passes a frame-valid envelope through to the store unchanged", async () => {
    vi.mocked(putFinConfig).mockResolvedValue("ok");
    const bytes = envelope(64);
    const res = await putReq(bytes);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(vi.mocked(putFinConfig).mock.calls[0][0]).toEqual(bytes);
  });

  it("PUT 404s an oversize blob before touching the store", async () => {
    const res = await putReq(envelope(FIN_MAX_BYTES + 1));
    expect(res.status).toBe(404);
    expect(putFinConfig).not.toHaveBeenCalled();
  });

  it("PUT 404s a body too short to hold the envelope frame", async () => {
    // 32 bytes = one short of the 33-byte floor (4 magic + 12 IV + 16 tag + 1).
    const res = await putReq(envelope(32));
    expect(res.status).toBe(404);
    expect(putFinConfig).not.toHaveBeenCalled();
  });

  it("PUT 404s a bad magic prefix and never writes", async () => {
    const res = await putReq(envelope(40, "AEVX"));
    expect(res.status).toBe(404);
    expect(putFinConfig).not.toHaveBeenCalled();
  });

  it("PUT without the overwrite header writes no-overwrite (setup can't clobber)", async () => {
    vi.mocked(putFinConfig).mockResolvedValue("ok");
    await putReq(envelope());
    expect(vi.mocked(putFinConfig).mock.calls[0][1]).toBe(false);
  });

  it("PUT passes overwrite through only with x-fin-overwrite: 1", async () => {
    vi.mocked(putFinConfig).mockResolvedValue("ok");
    await putReq(envelope(), { "x-fin-overwrite": "1" });
    expect(vi.mocked(putFinConfig).mock.calls[0][1]).toBe(true);
  });

  it("PUT 409s when a config already exists and overwrite wasn't asked", async () => {
    vi.mocked(putFinConfig).mockResolvedValue("conflict");
    expect((await putReq(envelope())).status).toBe(409);
  });

  it("PUT 404s when the store write fails", async () => {
    vi.mocked(putFinConfig).mockResolvedValue("failed");
    expect((await putReq(envelope())).status).toBe(404);
  });
});
