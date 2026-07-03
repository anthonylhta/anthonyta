import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleRiichiStats } from "@/lib/riichi";
import { getRiichiStats } from "./riichi";

vi.mock("postgres", () => ({
  default: vi.fn(() => {
    throw new Error("malformed connection string");
  }),
}));

describe("getRiichiStats — guarded fallback (connector invariant)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns sample stats instead of throwing when the DB URL is malformed", async () => {
    vi.stubEnv("RIICHI_DATABASE_URL", "not a url");
    vi.stubEnv("RIICHI_USER_ID", "2");
    await expect(getRiichiStats()).resolves.toBe(sampleRiichiStats);
  });

  it("returns sample stats when the DB is not configured", async () => {
    vi.stubEnv("RIICHI_DATABASE_URL", "");
    vi.stubEnv("RIICHI_USER_ID", "2");
    await expect(getRiichiStats()).resolves.toBe(sampleRiichiStats);
  });
});
