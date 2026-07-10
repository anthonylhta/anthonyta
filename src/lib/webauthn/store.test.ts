import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get, put } from "@vercel/blob";
import { bootstrapOpen, getWebauthnRecord, putWebauthnRecord } from "./store";

vi.mock("@vercel/blob", () => ({ get: vi.fn(), put: vi.fn() }));

const mockGet = vi.mocked(get);
const mockPut = vi.mocked(put);

const ok = (body: string) =>
  ({ statusCode: 200, stream: new Response(body).body }) as unknown as Awaited<
    ReturnType<typeof get>
  >;

describe("getWebauthnRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is error when the store is off (no token)", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(await getWebauthnRecord()).toEqual({ state: "error" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("is absent on a healthy miss (null), never on a failure", async () => {
    mockGet.mockResolvedValue(null);
    expect(await getWebauthnRecord()).toEqual({ state: "absent" });
  });

  it("is ok with the body text on a 200", async () => {
    mockGet.mockResolvedValue(ok('{"v":1,"creds":[]}'));
    expect(await getWebauthnRecord()).toEqual({
      state: "ok",
      value: '{"v":1,"creds":[]}',
    });
    // read-modify-write correctness: the CDN cache must be bypassed
    expect(mockGet).toHaveBeenCalledWith("meta/webauthn", {
      access: "private",
      useCache: false,
    });
  });

  it("is error on a non-200 and on a throw", async () => {
    mockGet.mockResolvedValue({
      statusCode: 304,
      stream: null,
    } as unknown as Awaited<ReturnType<typeof get>>);
    expect(await getWebauthnRecord()).toEqual({ state: "error" });
    mockGet.mockRejectedValue(new Error("network"));
    expect(await getWebauthnRecord()).toEqual({ state: "error" });
  });
});

describe("putWebauthnRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fails when the store is off", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(await putWebauthnRecord("{}", true)).toBe("failed");
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("passes the overwrite flag through", async () => {
    mockPut.mockResolvedValue({} as Awaited<ReturnType<typeof put>>);
    expect(await putWebauthnRecord("{}", false)).toBe("ok");
    expect(mockPut).toHaveBeenCalledWith("meta/webauthn", "{}", {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json",
    });
    expect(await putWebauthnRecord("{}", true)).toBe("ok");
    expect(mockPut).toHaveBeenLastCalledWith(
      "meta/webauthn",
      "{}",
      expect.objectContaining({ allowOverwrite: true }),
    );
  });

  it("reports conflict when a first-run write raced an existing record", async () => {
    mockPut.mockRejectedValue(new Error("blob already exists"));
    mockGet.mockResolvedValue(ok('{"v":1,"creds":[]}'));
    expect(await putWebauthnRecord("{}", false)).toBe("conflict");
  });

  it("reports failed when the write throws and nothing exists", async () => {
    mockPut.mockRejectedValue(new Error("network"));
    mockGet.mockResolvedValue(null);
    expect(await putWebauthnRecord("{}", false)).toBe("failed");
    // an overwrite-mode throw is a plain failure, no conflict re-check
    expect(await putWebauthnRecord("{}", true)).toBe("failed");
  });
});

describe("bootstrapOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is closed while the secret is unset, without touching the store", async () => {
    mockGet.mockResolvedValue(null);
    expect(await bootstrapOpen("anything")).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("stays closed for a wrong or missing token, without touching the store", async () => {
    vi.stubEnv("WEBAUTHN_BOOTSTRAP", "the-real-secret");
    mockGet.mockResolvedValue(null); // absent — the ONLY other requirement
    expect(await bootstrapOpen("wrong-secret")).toBe(false);
    expect(await bootstrapOpen(null)).toBe(false);
    expect(await bootstrapOpen("")).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("opens only for the right secret AND a strictly-absent record", async () => {
    vi.stubEnv("WEBAUTHN_BOOTSTRAP", "the-real-secret");
    mockGet.mockResolvedValue(null); // absent
    expect(await bootstrapOpen("the-real-secret")).toBe(true);
    mockGet.mockResolvedValue(ok('{"v":1,"creds":[]}')); // exists
    expect(await bootstrapOpen("the-real-secret")).toBe(false);
    mockGet.mockRejectedValue(new Error("network")); // error ≠ absent
    expect(await bootstrapOpen("the-real-secret")).toBe(false);
  });
});
