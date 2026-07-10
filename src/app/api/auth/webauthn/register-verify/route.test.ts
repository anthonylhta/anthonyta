import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { auth } from "@/auth";
import { fromB64url } from "@/lib/crypto";
import { sealChallenge } from "@/lib/webauthn/cookie";
import { getWebauthnRecord, putWebauthnRecord } from "@/lib/webauthn/store";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/webauthn/store", () => ({
  getWebauthnRecord: vi.fn(),
  putWebauthnRecord: vi.fn(),
}));
vi.mock("@simplewebauthn/server", () => ({
  verifyRegistrationResponse: vi.fn(),
}));

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockGet = vi.mocked(getWebauthnRecord);
const mockPut = vi.mocked(putWebauthnRecord);
const mockVerify = vi.mocked(verifyRegistrationResponse);

const SECRET = "test-secret";

const verifiedInfo = (id = "new-cred") =>
  ({
    verified: true,
    registrationInfo: {
      credential: {
        id,
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ["internal"],
      },
    },
  }) as unknown as Awaited<ReturnType<typeof verifyRegistrationResponse>>;

function req(body: unknown, cookie?: string) {
  return POST(
    new Request("http://localhost/api/auth/webauthn/register-verify", {
      method: "POST",
      headers: cookie ? { cookie } : undefined,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const regCookie = () =>
  `webauthn-challenge=${sealChallenge("chal", "reg", SECRET)}`;

describe("webauthn/register-verify route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", SECRET);
    mockAuth.mockResolvedValue({ user: { name: "owner" } });
    mockGet.mockResolvedValue({ state: "absent" });
    mockPut.mockResolvedValue("ok");
    mockVerify.mockResolvedValue(verifiedInfo());
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("404s a guest without verifying anything", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await req({ response: {} }, regCookie())).status).toBe(404);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("400s without a valid reg challenge cookie", async () => {
    expect((await req({ response: {} })).status).toBe(400);
    const authTyped = `webauthn-challenge=${sealChallenge("c", "auth", SECRET)}`;
    expect((await req({ response: {} }, authTyped)).status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized bodies without a 500", async () => {
    expect((await req("not-json", regCookie())).status).toBe(400); // JSON.parse throws → catch
    expect((await req({ nope: 1 }, regCookie())).status).toBe(404);
    expect((await req("x".repeat(20_000), regCookie())).status).toBe(404);
  });

  it("400s a failed attestation and clears the cookie", async () => {
    mockVerify.mockResolvedValue({ verified: false } as Awaited<
      ReturnType<typeof verifyRegistrationResponse>
    >);
    const res = await req({ response: {} }, regCookie());
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("first enrollment writes a fresh record and returns the recovery code once", async () => {
    const res = await req({ response: {}, label: "  MacBook  " }, regCookie());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recovery).toMatch(/^[A-Za-z0-9_-]{22}$/);

    expect(mockPut).toHaveBeenCalledTimes(1);
    const [json, overwrite] = mockPut.mock.calls[0];
    expect(overwrite).toBe(false); // bootstrap must not clobber a raced record
    const record = JSON.parse(json);
    expect(record.creds).toHaveLength(1);
    expect(record.creds[0].label).toBe("macbook");
    expect(Array.from(fromB64url(record.creds[0].pk))).toEqual([1, 2, 3]);
    expect(record.recovery.hash_b64).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("409s when the bootstrap write loses a race", async () => {
    mockPut.mockResolvedValue("conflict");
    expect((await req({ response: {} }, regCookie())).status).toBe(409);
  });

  it("appends to an existing record with overwrite", async () => {
    mockGet.mockResolvedValue({
      state: "ok",
      value: JSON.stringify({
        v: 1,
        creds: [
          {
            id: "old",
            pk: "A".repeat(50),
            counter: 3,
            label: "iphone",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    });
    const res = await req({ response: {} }, regCookie());
    expect(res.status).toBe(200);
    expect((await res.json()).recovery).toBeUndefined(); // only the first mint returns a code
    const [json, overwrite] = mockPut.mock.calls[0];
    expect(overwrite).toBe(true);
    expect(JSON.parse(json).creds.map((c: { id: string }) => c.id)).toEqual([
      "old",
      "new-cred",
    ]);
  });

  it("409s a duplicate credential id", async () => {
    mockGet.mockResolvedValue({
      state: "ok",
      value: JSON.stringify({
        v: 1,
        creds: [
          {
            id: "new-cred",
            pk: "A".repeat(50),
            counter: 0,
            label: "iphone",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    });
    expect((await req({ response: {} }, regCookie())).status).toBe(409);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("503s on store error or a corrupt record — absent stays distinct", async () => {
    mockGet.mockResolvedValue({ state: "error" });
    expect((await req({ response: {} }, regCookie())).status).toBe(503);
    mockGet.mockResolvedValue({ state: "ok", value: "corrupt" });
    expect((await req({ response: {} }, regCookie())).status).toBe(503);
    expect(mockPut).not.toHaveBeenCalled();
  });
});
