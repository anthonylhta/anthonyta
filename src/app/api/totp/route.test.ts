import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { getTotpConfig, putTotpConfig, TOTP_MAX_BYTES } from "@/lib/totpstore";
import { GET, PUT } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/totpstore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/totpstore")>()),
  getTotpConfig: vi.fn(),
  putTotpConfig: vi.fn(),
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
    new Request("http://localhost/api/totp", {
      method: "PUT",
      headers,
      body: body.slice().buffer as ArrayBuffer,
    }),
  );
}

describe("totp route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { name: "owner" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("404s a guest on GET and PUT without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    expect((await putReq(envelope())).status).toBe(404);
    expect(getTotpConfig).not.toHaveBeenCalled();
    expect(putTotpConfig).not.toHaveBeenCalled();
  });

  it("GET returns the stored envelope bytes, uncacheable", async () => {
    const bytes = envelope(48);
    vi.mocked(getTotpConfig).mockResolvedValue({ state: "ok", value: bytes });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("GET 404s an empty drawer, 503s a transient failure — never conflated", async () => {
    vi.mocked(getTotpConfig).mockResolvedValue({ state: "absent" });
    expect((await GET()).status).toBe(404);
    vi.mocked(getTotpConfig).mockResolvedValue({ state: "error" });
    expect((await GET()).status).toBe(503);
  });

  it("PUT passes a frame-valid envelope through unchanged", async () => {
    vi.mocked(putTotpConfig).mockResolvedValue("ok");
    const bytes = envelope(64);
    const res = await putReq(bytes);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(vi.mocked(putTotpConfig).mock.calls[0][0]).toEqual(bytes);
  });

  it("PUT 404s oversize, too-short, and bad-magic bodies before the store", async () => {
    expect((await putReq(envelope(TOTP_MAX_BYTES + 1))).status).toBe(404);
    expect((await putReq(envelope(32))).status).toBe(404); // one under the 33-byte floor
    expect((await putReq(envelope(40, "AEVX"))).status).toBe(404);
    expect(putTotpConfig).not.toHaveBeenCalled();
  });

  it("PUT is no-overwrite by default; x-totp-overwrite: 1 flips it; conflict → 409", async () => {
    vi.mocked(putTotpConfig).mockResolvedValue("ok");
    await putReq(envelope());
    expect(vi.mocked(putTotpConfig).mock.calls[0][1]).toBe(false);
    await putReq(envelope(), { "x-totp-overwrite": "1" });
    expect(vi.mocked(putTotpConfig).mock.calls[1][1]).toBe(true);

    vi.mocked(putTotpConfig).mockResolvedValue("conflict");
    expect((await putReq(envelope())).status).toBe(409);
  });

  it("PUT 404s when the store write fails", async () => {
    vi.mocked(putTotpConfig).mockResolvedValue("failed");
    expect((await putReq(envelope())).status).toBe(404);
  });
});
