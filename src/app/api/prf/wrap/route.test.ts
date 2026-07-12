import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { getPrfWrapSet, putPrfWrapSet } from "@/lib/prfstore";
import type { PrfWrapSet } from "@/lib/prf";
import { GET, PUT } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prfstore", () => ({
  getPrfWrapSet: vi.fn(),
  putPrfWrapSet: vi.fn(),
  PRF_WRAP_MAX_BYTES: 16384,
}));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const set: PrfWrapSet = {
  v: 1,
  wraps: [
    {
      v: 1,
      credential_id_b64: "cred1",
      wrapped_mk_b64: "AAAA",
      iv_b64: "BBBB",
    },
  ],
};

function putReq(body: unknown, raw?: string) {
  return PUT(
    new Request("http://localhost/api/prf/wrap", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

describe("prf/wrap route", () => {
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
    expect(getPrfWrapSet).not.toHaveBeenCalled();
  });

  it("404s a guest on PUT without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await putReq(set)).status).toBe(404);
    expect(putPrfWrapSet).not.toHaveBeenCalled();
  });

  it("GET returns the stored set, uncacheable", async () => {
    vi.mocked(getPrfWrapSet).mockResolvedValue({ state: "ok", value: set });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(set);
  });

  it("GET 404s when no wraps are enrolled yet (healthy miss)", async () => {
    vi.mocked(getPrfWrapSet).mockResolvedValue({ state: "absent" });
    expect((await GET()).status).toBe(404);
  });

  it("GET 503s a transient store failure — NEVER the 404 miss", async () => {
    vi.mocked(getPrfWrapSet).mockResolvedValue({ state: "error" });
    expect((await GET()).status).toBe(503);
  });

  it("PUT writes a validated set, rebuilt from its fields", async () => {
    vi.mocked(putPrfWrapSet).mockResolvedValue(true);
    const res = await putReq({
      // an extra field must be stripped by the rebuild
      v: 1,
      wraps: [{ ...set.wraps[0], junk: "x" }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(vi.mocked(putPrfWrapSet).mock.calls[0][0]).toEqual(set);
  });

  it("PUT 404s a shape-invalid body and never writes", async () => {
    const res = await putReq({ v: 2, wraps: [] });
    expect(res.status).toBe(404);
    expect(putPrfWrapSet).not.toHaveBeenCalled();
  });

  it("PUT 404s a body over the size cap before touching the store", async () => {
    const res = await putReq(null, "x".repeat(16385));
    expect(res.status).toBe(404);
    expect(putPrfWrapSet).not.toHaveBeenCalled();
  });

  it("PUT 404s malformed JSON without throwing", async () => {
    const res = await putReq(null, "{not json");
    expect(res.status).toBe(404);
    expect(putPrfWrapSet).not.toHaveBeenCalled();
  });

  it("PUT 503s when the store write fails", async () => {
    vi.mocked(putPrfWrapSet).mockResolvedValue(false);
    expect((await putReq(set)).status).toBe(503);
  });
});
