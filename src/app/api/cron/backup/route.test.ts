import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBackup, runSweep } from "@/lib/backupcron";
import { authorizeCron } from "@/lib/cron-auth";
import { r2Enabled } from "@/lib/r2";
import { GET } from "./route";

vi.mock("@/lib/cron-auth", () => ({ authorizeCron: vi.fn() }));
vi.mock("@/lib/backupcron", () => ({ runBackup: vi.fn(), runSweep: vi.fn() }));
vi.mock("@/lib/r2", () => ({ r2Enabled: vi.fn() }));
vi.mock("@/lib/fin", () => ({ sydneyToday: () => "2026-09-27" }));

const req = () => new Request("http://localhost/api/cron/backup");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authorizeCron).mockReturnValue(null);
  vi.mocked(r2Enabled).mockReturnValue(true);
  vi.mocked(runBackup).mockResolvedValue({ copied: 3, failed: 1 });
  vi.mocked(runSweep).mockResolvedValue({
    deleted: 4,
    dates: ["2026-09-19"],
    kept: 7,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/cron/backup", () => {
  it("returns the gate's 401 without touching the store", async () => {
    vi.mocked(authorizeCron).mockReturnValue(
      new Response("Unauthorized", { status: 401 }),
    );
    expect((await GET(req())).status).toBe(401);
    expect(runBackup).not.toHaveBeenCalled();
    expect(runSweep).not.toHaveBeenCalled();
  });

  it("skips when the store is off", async () => {
    vi.mocked(r2Enabled).mockReturnValue(false);
    expect(await (await GET(req())).json()).toEqual({ skipped: "store off" });
    expect(runBackup).not.toHaveBeenCalled();
  });

  it("copies under the Sydney date, then sweeps, and reports", async () => {
    const body = await (await GET(req())).json();
    expect(runBackup).toHaveBeenCalledWith("2026-09-27");
    expect(vi.mocked(runBackup).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runSweep).mock.invocationCallOrder[0],
    );
    expect(body).toMatchObject({
      date: "2026-09-27",
      copied: 3,
      failed: 1,
      deleted: 4,
      kept: 7,
    });
    expect(typeof body.at).toBe("string");
  });

  it("isolates a failed job from the other", async () => {
    vi.mocked(runBackup).mockRejectedValue(
      new Error("r2 list failed: HTTP 500"),
    );
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ copied: -1, failed: -1, deleted: 4, kept: 7 });

    vi.mocked(runBackup).mockResolvedValue({ copied: 3, failed: 0 });
    vi.mocked(runSweep).mockRejectedValue(
      new Error("r2 list failed: HTTP 500"),
    );
    expect(await (await GET(req())).json()).toMatchObject({
      copied: 3,
      deleted: -1,
      kept: -1,
    });
  });
});
