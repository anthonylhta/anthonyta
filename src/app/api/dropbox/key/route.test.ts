import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import type { DropboxKey } from "@/lib/dropbox";
import { getDropboxKey, putDropboxKey } from "@/lib/dropstore";
import { GET, PUT } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/dropstore", () => ({
  DROPBOX_KEY_MAX_BYTES: 5000,
  getDropboxKey: vi.fn(),
  putDropboxKey: vi.fn(),
}));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const KEY: DropboxKey = {
  v: 1,
  alg: "ECDH-P256",
  pub_b64: "PUBPUBPUB",
  sealed_priv_b64: "SEALEDSECRET",
};

function putReq(body: unknown, raw?: string) {
  return PUT(
    new Request("http://localhost/api/dropbox/key", {
      method: "PUT",
      body: raw ?? JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { name: "owner" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dropbox/key route", () => {
  it("404s a guest on GET without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    expect(getDropboxKey).not.toHaveBeenCalled();
  });

  it("404s a guest on PUT without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await putReq(KEY)).status).toBe(404);
    expect(putDropboxKey).not.toHaveBeenCalled();
  });

  it("GET returns the full record to the owner (sealed priv is MK ciphertext)", async () => {
    vi.mocked(getDropboxKey).mockResolvedValue({ state: "ok", value: KEY });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(KEY);
  });

  it("GET 404s when the box isn't set up yet (absent)", async () => {
    vi.mocked(getDropboxKey).mockResolvedValue({ state: "absent" });
    expect((await GET()).status).toBe(404);
  });

  it("GET 503s a transient store failure — never the setup-triggering 404", async () => {
    vi.mocked(getDropboxKey).mockResolvedValue({ state: "error" });
    expect((await GET()).status).toBe(503);
  });

  it("PUT writes a valid record no-clobber and rebuilds it from validated fields", async () => {
    vi.mocked(putDropboxKey).mockResolvedValue("ok");
    const res = await putReq({ ...KEY, extra: "smuggled" });
    expect(res.status).toBe(200);
    expect(vi.mocked(putDropboxKey).mock.calls[0][0]).toEqual(KEY);
    expect(vi.mocked(putDropboxKey).mock.calls[0][1]).toBe(false);
  });

  it("PUT 404s a malformed record and never writes", async () => {
    const res = await putReq({ v: 2, alg: "ECDH-P256" });
    expect(res.status).toBe(404);
    expect(putDropboxKey).not.toHaveBeenCalled();
  });

  it("PUT 404s a non-JSON body", async () => {
    const res = await putReq(undefined, "not json{");
    expect(res.status).toBe(404);
    expect(putDropboxKey).not.toHaveBeenCalled();
  });

  it("PUT 409s when a box already exists (no-clobber conflict)", async () => {
    vi.mocked(putDropboxKey).mockResolvedValue("conflict");
    expect((await putReq(KEY)).status).toBe(409);
  });

  it("PUT 404s when the store write fails", async () => {
    vi.mocked(putDropboxKey).mockResolvedValue("failed");
    expect((await putReq(KEY)).status).toBe(404);
  });
});
