import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { getAperture } from "@/lib/aperturestore";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/aperturestore", () => ({ getAperture: vi.fn() }));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

/** A frame-valid AEV2 envelope: 4 magic bytes + deterministic filler. Invented
 *  bytes — the route never decrypts, so the contents only have to be stable. */
function envelope(totalLen = 40, magic = "AEV2"): Uint8Array {
  const out = new Uint8Array(totalLen);
  out.set(new TextEncoder().encode(magic).subarray(0, 4), 0);
  for (let i = 4; i < totalLen; i++) out[i] = (i * 7 + 3) % 256;
  return out;
}

describe("aperture route", () => {
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
    expect(getAperture).not.toHaveBeenCalled();
  });

  it("GET returns the stored envelope bytes, uncacheable", async () => {
    const bytes = envelope(48);
    vi.mocked(getAperture).mockResolvedValue({ state: "ok", value: bytes });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("GET 404s when nothing has been synced yet", async () => {
    vi.mocked(getAperture).mockResolvedValue({ state: "absent" });
    expect((await GET()).status).toBe(404);
  });

  it("GET 503s a transient store failure — NEVER the absent-signalling 404", async () => {
    // Aperture has no setup flow to mislead, but the honesty rule holds anyway: a
    // flake and "nothing synced yet" are different facts, and the island renders a
    // different line for each.
    vi.mocked(getAperture).mockResolvedValue({ state: "error" });
    expect((await GET()).status).toBe(503);
  });

  it("GET 404s when the store itself throws", async () => {
    vi.mocked(getAperture).mockRejectedValue(new Error("store exploded"));
    expect((await GET()).status).toBe(404);
  });
});
