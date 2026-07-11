import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { readVaultStream } from "@/lib/vaultstore";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/vaultstore", () => ({ readVaultStream: vi.fn() }));
// vaultblob is written concurrently; mock its guard to the frozen contract so the
// route's structural check is exercised here without the real module.
vi.mock("@/lib/vaultblob", () => {
  const VAULT_PREFIX = "vault/";
  return {
    VAULT_PREFIX,
    isValidVaultPath: (p: string): boolean => {
      if (!p.startsWith(VAULT_PREFIX) || p.includes("..")) return false;
      const leaf = p.slice(VAULT_PREFIX.length);
      return leaf === "index" || /^[ni]-[A-Za-z0-9_-]{22}\.bin$/.test(leaf);
    },
  };
});

// `auth` is overloaded (session getter vs middleware), which defeats vi.mocked's
// return-type inference — treat it as a plain mock for session values.
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

// A real 22-char blob id (nanoid alphabet); pairs with the `n-`/`i-` leaf prefix.
const ID = "AAAAAAAAAAAAAAAAAAAAAA";

function get(p: string) {
  return GET(
    new Request(`http://localhost/api/vault/raw?p=${encodeURIComponent(p)}`),
  );
}

describe("vault raw ciphertext route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { name: "owner" } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("404s a guest without touching the store", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await get(`vault/n-${ID}.bin`)).status).toBe(404);
    expect(readVaultStream).not.toHaveBeenCalled();
  });

  it("streams a vault blob's bytes through untouched", async () => {
    const bytes = new Uint8Array([65, 69, 86, 49, 9, 9, 9]);
    vi.mocked(readVaultStream).mockResolvedValue(
      new Blob([bytes]).stream() as ReadableStream,
    );
    const res = await get(`vault/n-${ID}.bin`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("streams the vault index blob", async () => {
    vi.mocked(readVaultStream).mockResolvedValue(
      new Blob([new Uint8Array([1, 2, 3])]).stream() as ReadableStream,
    );
    const res = await get("vault/index");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("404s a missing `p` without touching the store", async () => {
    const res = await GET(new Request("http://localhost/api/vault/raw"));
    expect(res.status).toBe(404);
    expect(readVaultStream).not.toHaveBeenCalled();
  });

  it("404s the keystore, traversal, and junk paths — raw can never leave `vault/`", async () => {
    for (const p of [
      "meta/keystore",
      "vault/../meta/keystore",
      "inbox/e-abc.bin",
      "vault/junk",
      "vault/",
      "",
    ]) {
      expect((await get(p)).status).toBe(404);
    }
    expect(readVaultStream).not.toHaveBeenCalled();
  });

  it("404s when the blob is missing or the store is off", async () => {
    vi.mocked(readVaultStream).mockResolvedValue(null);
    expect((await get(`vault/n-${ID}.bin`)).status).toBe(404);
  });
});
