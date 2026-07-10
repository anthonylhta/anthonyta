import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { getWebauthnRecord } from "@/lib/webauthn/store";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/webauthn/store", () => ({
  getWebauthnRecord: vi.fn(),
  putWebauthnRecord: vi.fn(),
}));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockGet = vi.mocked(getWebauthnRecord);

const RECORD = JSON.stringify({
  v: 1,
  creds: [
    {
      id: "existing-cred",
      pk: "A".repeat(100),
      counter: 0,
      transports: ["internal"],
      label: "iphone",
      createdAt: "2026-07-10T00:00:00Z",
    },
  ],
});

describe("webauthn/register-options route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_SECRET", "test-secret");
    mockAuth.mockResolvedValue({ user: { name: "owner" } });
    mockGet.mockResolvedValue({ state: "absent" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("404s a guest without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await POST()).status).toBe(404);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("503s on a store error instead of inviting a duplicate enrollment", async () => {
    mockGet.mockResolvedValue({ state: "error" });
    expect((await POST()).status).toBe(503);
  });

  it("503s on a corrupt record", async () => {
    mockGet.mockResolvedValue({ state: "ok", value: "not-json" });
    expect((await POST()).status).toBe(503);
    mockGet.mockResolvedValue({ state: "ok", value: '{"v":99}' });
    expect((await POST()).status).toBe(503);
  });

  it("mints discoverable, user-verified options with the challenge cookie", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const options = await res.json();
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(options.rp.id).toBe("localhost");
    expect(options.authenticatorSelection.residentKey).toBe("required");
    expect(options.authenticatorSelection.userVerification).toBe("required");
    expect(options.excludeCredentials).toEqual([]);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("webauthn-challenge=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/auth");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("excludes already-enrolled credentials", async () => {
    mockGet.mockResolvedValue({ state: "ok", value: RECORD });
    const options = await (await POST()).json();
    expect(options.excludeCredentials).toEqual([
      { id: "existing-cred", transports: ["internal"], type: "public-key" },
    ]);
  });
});
