import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driveToken } from "@/lib/google";
import { getPortfolio } from "./portfolio";

vi.mock("@/lib/google", () => ({ driveToken: vi.fn() }));

describe("getPortfolio — guarded fallback (connector invariant)", () => {
  beforeEach(() => {
    vi.stubEnv("BRIEFING_FOLDER_ID", "folder-id");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null instead of throwing when driveToken() rejects", async () => {
    vi.mocked(driveToken).mockRejectedValue(new Error("transient auth error"));
    await expect(getPortfolio()).resolves.toBeNull();
  });

  it("returns null when there is no token (missing config)", async () => {
    vi.mocked(driveToken).mockResolvedValue(null);
    await expect(getPortfolio()).resolves.toBeNull();
  });
});
