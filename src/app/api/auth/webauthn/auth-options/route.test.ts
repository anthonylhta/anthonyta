import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openChallenge } from "@/lib/webauthn/cookie";
import { getWebauthnRecord } from "@/lib/webauthn/store";
import { POST } from "./route";

vi.mock("@/lib/webauthn/store", () => ({ getWebauthnRecord: vi.fn() }));

const SECRET = "test-secret";

describe("webauthn/auth-options route", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mints silent, discoverable options for anyone", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const options = await res.json();
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(options.rpId).toBe("localhost");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe("required");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("seals the same challenge into the auth-typed cookie", async () => {
    const res = await POST();
    const options = await res.json();
    const cookie = res.headers.get("set-cookie") ?? "";
    const sealed = cookie.match(/webauthn-challenge=([^;]+)/)?.[1] ?? "";
    expect(openChallenge(sealed, "auth", SECRET)).toBe(options.challenge);
    expect(openChallenge(sealed, "reg", SECRET)).toBeNull();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("mints a fresh challenge per call", async () => {
    const a = await (await POST()).json();
    const b = await (await POST()).json();
    expect(a.challenge).not.toBe(b.challenge);
  });

  it("never reads the record — the empty allow list can't enumerate credentials", async () => {
    // Anti-enumeration is structural: with no store read, an enrolled passkey
    // cannot leak into the public options. Lock that a refactor can't add one.
    const options = await (await POST()).json();
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(getWebauthnRecord).not.toHaveBeenCalled();
  });
});
