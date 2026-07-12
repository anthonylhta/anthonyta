import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DropboxKey } from "@/lib/dropbox";
import { getDropboxKey } from "@/lib/dropstore";
import { GET } from "./route";

vi.mock("@/lib/dropstore", () => ({ getDropboxKey: vi.fn() }));

const KEY: DropboxKey = {
  v: 1,
  alg: "ECDH-P256",
  pub_b64: "PUBPUBPUB",
  sealed_priv_b64: "SEALEDSECRET",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dropbox/pubkey route", () => {
  it("serves the public half ONLY — never the sealed private key", async () => {
    vi.mocked(getDropboxKey).mockResolvedValue({ state: "ok", value: KEY });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ pub_b64: "PUBPUBPUB" });
    expect(JSON.stringify(body)).not.toContain("SEALEDSECRET");
  });

  it("404s when the box isn't enabled (absent)", async () => {
    vi.mocked(getDropboxKey).mockResolvedValue({ state: "absent" });
    expect((await GET()).status).toBe(404);
  });

  it("404s on a store error — no enabled/disabled oracle", async () => {
    vi.mocked(getDropboxKey).mockResolvedValue({ state: "error" });
    expect((await GET()).status).toBe(404);
  });
});
