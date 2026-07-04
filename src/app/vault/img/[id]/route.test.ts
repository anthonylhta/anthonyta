import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { getVaultImages } from "@/lib/connectors/vault";
import { driveToken } from "@/lib/google";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/connectors/vault", () => ({ getVaultImages: vi.fn() }));
vi.mock("@/lib/google", () => ({ driveToken: vi.fn() }));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const IMAGE = {
  id: "abc123",
  name: "shot.png",
  path: "A/shot.png",
  mimeType: "image/png",
};

function get(id: string) {
  return GET(new Request("http://localhost/vault/img/" + id), {
    params: Promise.resolve({ id }),
  });
}

describe("vault image route — graceful degrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { name: "owner" } });
    vi.mocked(getVaultImages).mockResolvedValue([IMAGE]);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 404 instead of throwing when driveToken() rejects", async () => {
    vi.mocked(driveToken).mockRejectedValue(new Error("transient auth error"));
    const res = await get("abc123");
    expect(res.status).toBe(404);
  });

  it("returns 404 instead of throwing when the Drive fetch rejects", async () => {
    vi.mocked(driveToken).mockResolvedValue("tok");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("fetch failed"),
    );
    const res = await get("abc123");
    expect(res.status).toBe(404);
  });

  it("still 404s a guest before touching Drive", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await get("abc123");
    expect(res.status).toBe(404);
    expect(driveToken).not.toHaveBeenCalled();
  });
});
