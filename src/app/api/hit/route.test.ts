import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { recordHit, todayVisitorHash } from "@/lib/anastore";
import { r2Enabled } from "@/lib/r2";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/anastore", () => ({
  todayVisitorHash: vi.fn(),
  recordHit: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({ r2Enabled: vi.fn() }));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockEnabled = vi.mocked(r2Enabled);
const mockHash = vi.mocked(todayVisitorHash);
const mockRecord = vi.mocked(recordHit);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

function hit(
  body: unknown = { path: "/projects" },
  headers: Record<string, string> = {},
) {
  return POST(
    new Request("http://localhost/api/hit", {
      method: "POST",
      headers: {
        "user-agent": UA,
        "x-forwarded-for": "203.0.113.9",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** Assert the frozen contract: 204, no readable body. */
async function expect204(res: Response) {
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
}

describe("POST /api/hit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnabled.mockReturnValue(true);
    mockAuth.mockResolvedValue(null); // a guest by default
    mockHash.mockResolvedValue(new Uint8Array(32).fill(7));
    mockRecord.mockResolvedValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("records a guest pageview and returns an empty 204", async () => {
    await expect204(await hit());
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0][1]).toBe("/projects");
  });

  it("no-ops when the store is off", async () => {
    mockEnabled.mockReturnValue(false);
    await expect204(await hit());
    expect(mockHash).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("skips the owner's own traffic", async () => {
    mockAuth.mockResolvedValue({ user: { name: "anthony" } });
    await expect204(await hit());
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("skips crawlers by user-agent", async () => {
    await expect204(
      await hit({ path: "/" }, { "user-agent": "Googlebot/2.1" }),
    );
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("skips a missing user-agent", async () => {
    await expect204(await hit({ path: "/" }, { "user-agent": "" }));
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("honours DNT and Sec-GPC opt-outs", async () => {
    await expect204(await hit({ path: "/" }, { dnt: "1" }));
    await expect204(await hit({ path: "/" }, { "sec-gpc": "1" }));
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("drops non-app paths (traversal, protocol-relative, off-origin, junk)", async () => {
    for (const path of [
      "no-leading-slash",
      "//evil.example",
      "/a/../../etc/passwd",
      "https://evil.example/x",
      "/a\\b",
      123,
      null,
      "/" + "x".repeat(600),
    ]) {
      await expect204(await hit({ path }));
    }
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("drops a malformed JSON body without erroring", async () => {
    await expect204(await hit("{ not json"));
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("still 204s when the salt read skips the hit (hash null)", async () => {
    mockHash.mockResolvedValue(null);
    await expect204(await hit());
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("never errors the response when recording throws", async () => {
    mockRecord.mockRejectedValue(new Error("store flake"));
    await expect204(await hit());
  });
});
