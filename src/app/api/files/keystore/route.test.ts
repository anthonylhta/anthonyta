import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { getKeystore, putKeystore } from "@/lib/inbox";
import { GET, PUT } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/inbox", () => ({
  getKeystore: vi.fn(),
  putKeystore: vi.fn(),
  KEYSTORE_MAX_BYTES: 2048,
}));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const KEYSTORE = {
  v: 1,
  kdf: { salt_b64: "c2FsdHNhbHRzYWx0c2FsdA", iterations: 600_000 },
  wrapped_mk_b64: "d3JhcHBlZG1rd3JhcHBlZG1rd3JhcHBlZG1rd3JhcHBlZA",
  iv_b64: "aXZpdml2aXZpdml2",
};

function putReq(body: string) {
  return PUT(
    new Request("http://localhost/api/files/keystore", {
      method: "PUT",
      body,
    }),
  );
}

describe("keystore route", () => {
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
    expect(getKeystore).not.toHaveBeenCalled();
  });

  it("404s a guest on PUT without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await putReq(JSON.stringify(KEYSTORE))).status).toBe(404);
    expect(putKeystore).not.toHaveBeenCalled();
  });

  it("GET returns the stored keystore JSON, uncacheable", async () => {
    vi.mocked(getKeystore).mockResolvedValue({
      state: "ok",
      json: JSON.stringify(KEYSTORE),
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(KEYSTORE);
  });

  it("GET 404s when no keystore exists yet (first-run setup signal)", async () => {
    vi.mocked(getKeystore).mockResolvedValue({ state: "absent" });
    expect((await GET()).status).toBe(404);
  });

  it("GET 503s a transient store failure — NEVER the setup-triggering 404", async () => {
    vi.mocked(getKeystore).mockResolvedValue({ state: "error" });
    expect((await GET()).status).toBe(503);
  });

  it("PUT stores exactly the validated shape, dropping smuggled keys", async () => {
    vi.mocked(putKeystore).mockResolvedValue("ok");
    const res = await putReq(JSON.stringify({ ...KEYSTORE, evil: "extra" }));
    expect(res.status).toBe(200);
    const stored = JSON.parse(vi.mocked(putKeystore).mock.calls[0][0]);
    expect(stored).toEqual(KEYSTORE);
  });

  it("PUT stores a v2 keystore's canary alongside the validated shape", async () => {
    vi.mocked(putKeystore).mockResolvedValue("ok");
    const v2 = { ...KEYSTORE, v: 2, canary_b64: "Y2FuYXJ5ZW52ZWxvcGU" };
    const res = await putReq(JSON.stringify({ ...v2, evil: "extra" }));
    expect(res.status).toBe(200);
    const stored = JSON.parse(vi.mocked(putKeystore).mock.calls[0][0]);
    expect(stored).toEqual(v2);
  });

  it("PUT without the overwrite header writes no-overwrite (setup can't clobber)", async () => {
    vi.mocked(putKeystore).mockResolvedValue("ok");
    await putReq(JSON.stringify(KEYSTORE));
    expect(vi.mocked(putKeystore).mock.calls[0][1]).toBe(false);
  });

  it("PUT passes overwrite through only with x-keystore-overwrite: 1", async () => {
    vi.mocked(putKeystore).mockResolvedValue("ok");
    await PUT(
      new Request("http://localhost/api/files/keystore", {
        method: "PUT",
        headers: { "x-keystore-overwrite": "1" },
        body: JSON.stringify(KEYSTORE),
      }),
    );
    expect(vi.mocked(putKeystore).mock.calls[0][1]).toBe(true);
  });

  it("PUT 409s when a keystore already exists and overwrite wasn't asked", async () => {
    vi.mocked(putKeystore).mockResolvedValue("conflict");
    expect((await putReq(JSON.stringify(KEYSTORE))).status).toBe(409);
  });

  it("PUT 404s a malformed shape and never writes", async () => {
    for (const bad of [
      "not json",
      "{}",
      JSON.stringify({ ...KEYSTORE, v: 2 }),
    ]) {
      expect((await putReq(bad)).status).toBe(404);
    }
    expect(putKeystore).not.toHaveBeenCalled();
  });

  it("PUT 404s an oversized body before parsing", async () => {
    const res = await putReq("x".repeat(4096));
    expect(res.status).toBe(404);
    expect(putKeystore).not.toHaveBeenCalled();
  });

  it("PUT 404s a sub-floor iteration count (downgrade attempt)", async () => {
    const weak = { ...KEYSTORE, kdf: { ...KEYSTORE.kdf, iterations: 1000 } };
    expect((await putReq(JSON.stringify(weak))).status).toBe(404);
    expect(putKeystore).not.toHaveBeenCalled();
  });

  it("PUT 404s when the store write fails", async () => {
    vi.mocked(putKeystore).mockResolvedValue("failed");
    expect((await putReq(JSON.stringify(KEYSTORE))).status).toBe(404);
  });
});
