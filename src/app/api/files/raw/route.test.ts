import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { readFileStream } from "@/lib/inbox";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/inbox", () => ({ readFileStream: vi.fn() }));

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

function get(p: string) {
  return GET(
    new Request(`http://localhost/api/files/raw?p=${encodeURIComponent(p)}`),
  );
}

describe("raw ciphertext route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { name: "owner" } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("404s a guest without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await get("inbox/e-abc.bin")).status).toBe(404);
    expect(readFileStream).not.toHaveBeenCalled();
  });

  it("streams the blob bytes through untouched", async () => {
    const bytes = new Uint8Array([65, 69, 86, 49, 9, 9, 9]);
    vi.mocked(readFileStream).mockResolvedValue(
      new Blob([bytes]).stream() as ReadableStream,
    );
    const res = await get("inbox/e-abc.bin");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("404s the keystore path — raw can never exfiltrate key material", async () => {
    expect((await get("meta/keystore")).status).toBe(404);
    expect(readFileStream).not.toHaveBeenCalled();
  });

  it("404s traversal probes and junk pathnames", async () => {
    for (const p of ["inbox/../meta/keystore", "inbox/a b", "", "inbox/"]) {
      expect((await get(p)).status).toBe(404);
    }
    expect(readFileStream).not.toHaveBeenCalled();
  });

  it("404s when the blob is missing or the store is off", async () => {
    vi.mocked(readFileStream).mockResolvedValue(null);
    expect((await get("inbox/e-missing.bin")).status).toBe(404);
  });
});
