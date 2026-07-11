import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { r2Enabled, r2PresignPut } from "@/lib/r2";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/r2")>()),
  r2Enabled: vi.fn(),
  r2PresignPut: vi.fn(),
}));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockEnabled = vi.mocked(r2Enabled);
const mockPresign = vi.mocked(r2PresignPut);

const ENC = "inbox/e-mB4d5S3CkQxGxUKz2AkKfg.bin";
const SHARE = "share/1900000000-e-mB4d5S3CkQxGxUKz2AkKfg.bin";

function mint(body: unknown) {
  return POST(
    new Request("http://localhost/api/files/upload", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("upload mint route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { name: "owner" } });
    mockEnabled.mockReturnValue(true);
    mockPresign.mockResolvedValue("https://acct.r2.example/signed");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("404s a guest without minting", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await mint({ pathname: ENC, size: 100 })).status).toBe(404);
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it("mints a presigned PUT for a valid E2EE inbox envelope", async () => {
    const res = await mint({ pathname: ENC, size: 100 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://acct.r2.example/signed" });
    expect(mockPresign).toHaveBeenCalledWith(ENC, 900);
  });

  it("mints for a valid share envelope", async () => {
    expect((await mint({ pathname: SHARE, size: 100 })).status).toBe(200);
    expect(mockPresign).toHaveBeenCalledWith(SHARE, 900);
  });

  it("404s every forged or plaintext-shaped pathname without minting", async () => {
    for (const pathname of [
      "meta/keystore", // key material — structurally excluded
      "vault/abc.bin", // vault ciphertext — wrong prefix
      "inbox/photo.jpg", // plaintext-shaped inbox name (client always seals)
      "inbox/../meta/keystore", // traversal probe
      "share/9999-e-short.bin", // malformed share segment
      "", // junk
      42, // not a string
    ]) {
      expect((await mint({ pathname, size: 100 })).status).toBe(404);
    }
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it("404s a missing, non-integer, zero, or over-cap size", async () => {
    for (const size of [undefined, "100", 1.5, 0, -1, 26 * 1024 * 1024 + 1]) {
      expect((await mint({ pathname: ENC, size })).status).toBe(404);
    }
    // the cap itself is allowed
    expect((await mint({ pathname: ENC, size: 26 * 1024 * 1024 })).status).toBe(
      200,
    );
  });

  it("404s when the store is off and on a malformed body", async () => {
    mockEnabled.mockReturnValue(false);
    expect((await mint({ pathname: ENC, size: 100 })).status).toBe(404);
    mockEnabled.mockReturnValue(true);
    const res = await POST(
      new Request("http://localhost/api/files/upload", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("404s when presigning throws", async () => {
    mockPresign.mockRejectedValue(new Error("boom"));
    expect((await mint({ pathname: ENC, size: 100 })).status).toBe(404);
  });
});
