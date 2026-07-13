import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { sealChallenge } from "./cookie";
import { hashRecoveryCode } from "./recovery";
import { getWebauthnRecord, putWebauthnRecord } from "./store";
import { verifyDoor } from "./verify";

vi.mock("./store", () => ({
  getWebauthnRecord: vi.fn(),
  putWebauthnRecord: vi.fn(),
}));
vi.mock("@simplewebauthn/server", () => ({
  verifyAuthenticationResponse: vi.fn(),
}));

const mockGet = vi.mocked(getWebauthnRecord);
const mockPut = vi.mocked(putWebauthnRecord);
const mockVerify = vi.mocked(verifyAuthenticationResponse);

const SECRET = "test-secret";

const RECORD = {
  v: 1,
  creds: [
    {
      id: "cred-a",
      pk: "AQID",
      counter: 5,
      transports: ["internal"],
      label: "iphone",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
  recovery: { hash_b64: hashRecoveryCode("the-code"), createdAt: "2026-01-01" },
};

const assertion = (id = "cred-a") => JSON.stringify({ id, response: {} });

function req(cookie?: string) {
  return new Request("http://localhost/api/auth/callback/webauthn", {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
  });
}

const authCookie = () =>
  `webauthn-challenge=${sealChallenge("chal", "auth", SECRET)}`;

describe("verifyDoor — assertion path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", SECRET);
    vi.stubEnv("OWNER_GITHUB_LOGIN", "anthonylhta");
    mockGet.mockResolvedValue({ state: "ok", value: JSON.stringify(RECORD) });
    mockPut.mockResolvedValue("ok");
    mockVerify.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    } as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("signs the owner in on a verified assertion", async () => {
    const user = await verifyDoor(
      { assertion: assertion() },
      req(authCookie()),
    );
    expect(user).toEqual({ id: "owner", name: "anthonylhta" });
    const call = mockVerify.mock.calls[0][0];
    expect(call.expectedChallenge).toBe("chal");
    expect(call.expectedRPID).toBe("localhost");
    expect(call.credential.counter).toBe(5);
    expect(Array.from(call.credential.publicKey)).toEqual([1, 2, 3]);
    expect(call.requireUserVerification).toBe(true);
  });

  it("denies without a cookie, with a reg-typed cookie, and when expired", async () => {
    expect(await verifyDoor({ assertion: assertion() }, req())).toBeNull();
    const regCookie = `webauthn-challenge=${sealChallenge("c", "reg", SECRET)}`;
    expect(
      await verifyDoor({ assertion: assertion() }, req(regCookie)),
    ).toBeNull();
    const stale = `webauthn-challenge=${sealChallenge("c", "auth", SECRET, Date.now() - 500_000)}`;
    expect(await verifyDoor({ assertion: assertion() }, req(stale))).toBeNull();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("denies on record absent/error and unknown credential", async () => {
    mockGet.mockResolvedValue({ state: "absent" });
    expect(
      await verifyDoor({ assertion: assertion() }, req(authCookie())),
    ).toBeNull();
    mockGet.mockResolvedValue({ state: "error" });
    expect(
      await verifyDoor({ assertion: assertion() }, req(authCookie())),
    ).toBeNull();
    mockGet.mockResolvedValue({ state: "ok", value: JSON.stringify(RECORD) });
    expect(
      await verifyDoor({ assertion: assertion("unknown") }, req(authCookie())),
    ).toBeNull();
  });

  it("denies oversized and malformed assertions without throwing", async () => {
    expect(
      await verifyDoor({ assertion: "x".repeat(20_000) }, req(authCookie())),
    ).toBeNull();
    expect(
      await verifyDoor({ assertion: "not-json" }, req(authCookie())),
    ).toBeNull();
    expect(await verifyDoor({ assertion: 42 }, req(authCookie()))).toBeNull();
    expect(await verifyDoor({}, req(authCookie()))).toBeNull();
  });

  it("denies a failed verification", async () => {
    mockVerify.mockResolvedValue({ verified: false } as Awaited<
      ReturnType<typeof verifyAuthenticationResponse>
    >);
    expect(
      await verifyDoor({ assertion: assertion() }, req(authCookie())),
    ).toBeNull();
  });

  it("stamps the sign-in and stores an advanced counter, best-effort", async () => {
    await verifyDoor({ assertion: assertion() }, req(authCookie()));
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [json, overwrite] = mockPut.mock.calls[0];
    expect(overwrite).toBe(true);
    const stored = JSON.parse(json).creds[0];
    expect(stored.counter).toBe(6);
    expect(typeof stored.lastUsedAt).toBe("string");
    // a failed stamp write must not block the sign-in
    mockPut.mockResolvedValue("failed");
    expect(
      await verifyDoor({ assertion: assertion() }, req(authCookie())),
    ).toEqual({ id: "owner", name: "anthonylhta" });
  });

  it("stamps a synced passkey's sign-in without regressing its counter", async () => {
    mockVerify.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    } as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);
    const user = await verifyDoor(
      { assertion: assertion() },
      req(authCookie()),
    );
    expect(user).toEqual({ id: "owner", name: "anthonylhta" });
    // The sign-in is still stamped (a phone passkey reports 0 forever, and the
    // "last sign-in" line needs the timestamp), but the counter must never roll
    // back from 5 and read as a cloned authenticator.
    expect(mockPut).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(mockPut.mock.calls[0][0]).creds[0];
    expect(stored.counter).toBe(5);
    expect(typeof stored.lastUsedAt).toBe("string");
  });
});

describe("verifyDoor — recovery path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", SECRET);
    vi.stubEnv("OWNER_GITHUB_LOGIN", "anthonylhta");
    vi.stubEnv("WEBAUTHN_RECOVERY", "1");
    mockGet.mockResolvedValue({ state: "ok", value: JSON.stringify(RECORD) });
    mockPut.mockResolvedValue("ok");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("denies even the correct code while the flag is unset", async () => {
    vi.stubEnv("WEBAUTHN_RECOVERY", "");
    expect(await verifyDoor({ recovery: "the-code" }, req())).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("denies a wrong code and a record without a recovery hash", async () => {
    expect(await verifyDoor({ recovery: "wrong" }, req())).toBeNull();
    const consumed = { ...RECORD, recovery: undefined };
    mockGet.mockResolvedValue({
      state: "ok",
      value: JSON.stringify(consumed),
    });
    expect(await verifyDoor({ recovery: "the-code" }, req())).toBeNull();
  });

  it("consumes the code before returning the session", async () => {
    const user = await verifyDoor({ recovery: "the-code" }, req());
    expect(user).toEqual({ id: "owner", name: "anthonylhta" });
    const [json, overwrite] = mockPut.mock.calls[0];
    expect(overwrite).toBe(true);
    expect(JSON.parse(json).recovery).toBeUndefined();
  });

  it("denies when the consuming write fails — one-time stays one-time", async () => {
    mockPut.mockResolvedValue("failed");
    expect(await verifyDoor({ recovery: "the-code" }, req())).toBeNull();
  });
});
