import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { SNAPKEY_MAX_BYTES } from "@/lib/fin";
import { getSnapkey, putSnapkey } from "@/lib/finstore";
import { GET, PUT } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/finstore", () => ({
  getSnapkey: vi.fn(),
  putSnapkey: vi.fn(),
}));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const SNAPKEY = {
  v: 1,
  alg: "ECDH-P256",
  pub_b64: "BExamplePublicPointRawBytesBase64UrlEncodedHere",
  sealed_priv_b64: "c2VhbGVkcHJpdmF0ZWtleWJhc2U2NHVybGVuY29kZWQ",
};

function putReq(body: string, headers?: Record<string, string>) {
  return PUT(
    new Request("http://localhost/api/fin/snapkey", {
      method: "PUT",
      headers,
      body,
    }),
  );
}

describe("fin/snapkey route", () => {
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
    expect(getSnapkey).not.toHaveBeenCalled();
  });

  it("404s a guest on PUT without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await putReq(JSON.stringify(SNAPKEY))).status).toBe(404);
    expect(putSnapkey).not.toHaveBeenCalled();
  });

  it("GET returns the stored snapkey JSON raw, uncacheable", async () => {
    const json = JSON.stringify(SNAPKEY);
    vi.mocked(getSnapkey).mockResolvedValue({ state: "ok", value: json });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(json);
  });

  it("GET 404s when no snapkey exists yet (first-run setup signal)", async () => {
    vi.mocked(getSnapkey).mockResolvedValue({ state: "absent" });
    expect((await GET()).status).toBe(404);
  });

  it("GET 503s a transient store failure — NEVER the setup-triggering 404", async () => {
    vi.mocked(getSnapkey).mockResolvedValue({ state: "error" });
    expect((await GET()).status).toBe(503);
  });

  it("PUT stores exactly the validated shape, dropping smuggled keys", async () => {
    vi.mocked(putSnapkey).mockResolvedValue("ok");
    const res = await putReq(JSON.stringify({ ...SNAPKEY, evil: "extra" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const stored = JSON.parse(vi.mocked(putSnapkey).mock.calls[0][0]);
    expect(stored).toEqual(SNAPKEY);
  });

  it("PUT without the overwrite header writes no-overwrite (setup can't clobber)", async () => {
    vi.mocked(putSnapkey).mockResolvedValue("ok");
    await putReq(JSON.stringify(SNAPKEY));
    expect(vi.mocked(putSnapkey).mock.calls[0][1]).toBe(false);
  });

  it("PUT passes overwrite through only with x-snapkey-overwrite: 1", async () => {
    vi.mocked(putSnapkey).mockResolvedValue("ok");
    await putReq(JSON.stringify(SNAPKEY), { "x-snapkey-overwrite": "1" });
    expect(vi.mocked(putSnapkey).mock.calls[0][1]).toBe(true);
  });

  it("PUT 409s when a snapkey already exists and overwrite wasn't asked", async () => {
    vi.mocked(putSnapkey).mockResolvedValue("conflict");
    expect((await putReq(JSON.stringify(SNAPKEY))).status).toBe(409);
  });

  it("PUT 404s a malformed shape and never writes", async () => {
    for (const bad of [
      "not json",
      "{}",
      JSON.stringify({ ...SNAPKEY, alg: "ECDH-P384" }),
      JSON.stringify({ ...SNAPKEY, v: 2 }),
    ]) {
      expect((await putReq(bad)).status).toBe(404);
    }
    expect(putSnapkey).not.toHaveBeenCalled();
  });

  it("PUT 404s an oversized body before parsing, never writes", async () => {
    const res = await putReq("x".repeat(SNAPKEY_MAX_BYTES + 1));
    expect(res.status).toBe(404);
    expect(putSnapkey).not.toHaveBeenCalled();
  });

  it("PUT 404s when the store write fails", async () => {
    vi.mocked(putSnapkey).mockResolvedValue("failed");
    expect((await putReq(JSON.stringify(SNAPKEY))).status).toBe(404);
  });
});
