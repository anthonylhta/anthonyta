import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { readSnapshots } from "@/lib/finstore";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/finstore", () => ({
  readSnapshots: vi.fn(),
}));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

function getReq(query = "") {
  return GET(new Request(`http://localhost/api/fin/snapshots${query}`));
}

describe("fin/snapshots route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { name: "owner" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("404s a guest without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await getReq("?days=30")).status).toBe(404);
    expect(readSnapshots).not.toHaveBeenCalled();
  });

  it("clamps the days query into [1, 366], defaulting non-numeric to 30", async () => {
    vi.mocked(readSnapshots).mockResolvedValue({ state: "ok", days: [] });
    const table: [string, number][] = [
      ["", 30], // absent → default
      ["?days=abc", 30], // non-numeric → default
      ["?days=0", 1], // below floor → clamped up
      ["?days=999", 366], // above ceiling → clamped down
      ["?days=45", 45], // in range → passed through
    ];
    for (const [query, expected] of table) {
      vi.mocked(readSnapshots).mockClear();
      await getReq(query);
      expect(readSnapshots).toHaveBeenCalledWith(expected);
    }
  });

  it("returns an empty days array as a healthy 200, uncacheable", async () => {
    vi.mocked(readSnapshots).mockResolvedValue({ state: "ok", days: [] });
    const res = await getReq("?days=30");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ days: [] });
  });

  it("returns the sealed snapshot boxes on a healthy read", async () => {
    const days = [
      { date: "2026-07-01", box_b64: "QVNCMWZha2Vib3gx" },
      { date: "2026-07-02", box_b64: "QVNCMWZha2Vib3gy" },
    ];
    vi.mocked(readSnapshots).mockResolvedValue({ state: "ok", days });
    const res = await getReq("?days=7");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ days });
  });

  it("503s a transient store failure — the client must not read a flake as empty history", async () => {
    vi.mocked(readSnapshots).mockResolvedValue({ state: "error" });
    expect((await getReq("?days=30")).status).toBe(503);
  });
});
