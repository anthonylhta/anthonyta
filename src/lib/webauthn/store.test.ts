import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readKey, writeKey } from "@/lib/r2";
import { bootstrapOpen, getWebauthnRecord, putWebauthnRecord } from "./store";

vi.mock("@/lib/r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/r2")>()),
  readKey: vi.fn(),
  writeKey: vi.fn(),
}));

const mockRead = vi.mocked(readKey);
const mockWrite = vi.mocked(writeKey);

const okBytes = (body: string) =>
  ({ state: "ok", value: new TextEncoder().encode(body) }) as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getWebauthnRecord", () => {
  it("is error when the store reports error (off / transport)", async () => {
    mockRead.mockResolvedValue({ state: "error" });
    expect(await getWebauthnRecord()).toEqual({ state: "error" });
  });

  it("is absent on a healthy miss, never on a failure", async () => {
    mockRead.mockResolvedValue({ state: "absent" });
    expect(await getWebauthnRecord()).toEqual({ state: "absent" });
  });

  it("is ok with the body text on a hit, read from the fixed path", async () => {
    mockRead.mockResolvedValue(okBytes('{"v":1,"creds":[]}'));
    expect(await getWebauthnRecord()).toEqual({
      state: "ok",
      value: '{"v":1,"creds":[]}',
    });
    expect(mockRead).toHaveBeenCalledWith("meta/webauthn");
  });
});

describe("putWebauthnRecord", () => {
  it("passes the overwrite flag through to the no-clobber write", async () => {
    mockWrite.mockResolvedValue("ok");
    expect(await putWebauthnRecord("{}", false)).toBe("ok");
    expect(mockWrite).toHaveBeenCalledWith("meta/webauthn", "{}", {
      overwrite: false,
      contentType: "application/json",
    });
    expect(await putWebauthnRecord("{}", true)).toBe("ok");
    expect(mockWrite).toHaveBeenLastCalledWith(
      "meta/webauthn",
      "{}",
      expect.objectContaining({ overwrite: true }),
    );
  });

  it("passes conflict and failed straight through", async () => {
    mockWrite.mockResolvedValue("conflict");
    expect(await putWebauthnRecord("{}", false)).toBe("conflict");
    mockWrite.mockResolvedValue("failed");
    expect(await putWebauthnRecord("{}", false)).toBe("failed");
  });
});

describe("bootstrapOpen", () => {
  it("is closed while the secret is unset, without touching the store", async () => {
    mockRead.mockResolvedValue({ state: "absent" });
    expect(await bootstrapOpen("anything")).toBe(false);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("stays closed for a wrong or missing token, without touching the store", async () => {
    vi.stubEnv("WEBAUTHN_BOOTSTRAP", "the-real-secret");
    mockRead.mockResolvedValue({ state: "absent" }); // absent — the ONLY other requirement
    expect(await bootstrapOpen("wrong-secret")).toBe(false);
    expect(await bootstrapOpen(null)).toBe(false);
    expect(await bootstrapOpen("")).toBe(false);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("opens only for the right secret AND a strictly-absent record", async () => {
    vi.stubEnv("WEBAUTHN_BOOTSTRAP", "the-real-secret");
    mockRead.mockResolvedValue({ state: "absent" });
    expect(await bootstrapOpen("the-real-secret")).toBe(true);
    mockRead.mockResolvedValue(okBytes('{"v":1,"creds":[]}')); // exists
    expect(await bootstrapOpen("the-real-secret")).toBe(false);
    mockRead.mockResolvedValue({ state: "error" }); // error ≠ absent
    expect(await bootstrapOpen("the-real-secret")).toBe(false);
  });
});
