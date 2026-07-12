import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { deleteDrop } from "@/lib/dropstore";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/dropstore", () => ({ deleteDrop: vi.fn() }));

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

const VALID_PATH = `dropbox/${"A".repeat(22)}.bin`;

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/dropbox/delete", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { name: "owner" } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dropbox/delete route", () => {
  it("404s a guest without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await post({ path: VALID_PATH })).status).toBe(404);
    expect(deleteDrop).not.toHaveBeenCalled();
  });

  it("404s a malformed path before any delete", async () => {
    expect((await post({ path: "dropbox/../meta/keystore" })).status).toBe(404);
    expect((await post({})).status).toBe(404);
    expect(deleteDrop).not.toHaveBeenCalled();
  });

  it("deletes a valid path", async () => {
    vi.mocked(deleteDrop).mockResolvedValue(true);
    const res = await post({ path: VALID_PATH });
    expect(res.status).toBe(200);
    expect(deleteDrop).toHaveBeenCalledWith(VALID_PATH);
  });

  it("404s when the store refuses the delete", async () => {
    vi.mocked(deleteDrop).mockResolvedValue(false);
    expect((await post({ path: VALID_PATH })).status).toBe(404);
  });
});
