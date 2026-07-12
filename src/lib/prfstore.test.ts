import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readKey, writeKey } from "@/lib/r2";
import type { PrfWrapSet } from "./prf";
import { getPrfWrapSet, putPrfWrapSet } from "./prfstore";

vi.mock("@/lib/r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/r2")>()),
  readKey: vi.fn(),
  writeKey: vi.fn(),
}));

const mockRead = vi.mocked(readKey);
const mockWrite = vi.mocked(writeKey);

const set: PrfWrapSet = {
  v: 1,
  wraps: [
    {
      v: 1,
      credential_id_b64: "cred1",
      wrapped_mk_b64: "AAAA",
      iv_b64: "BBBB",
    },
  ],
};

const okBytes = (body: string) =>
  ({ state: "ok", value: new TextEncoder().encode(body) }) as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("getPrfWrapSet", () => {
  it("is error when the store reports error (off / transport)", async () => {
    mockRead.mockResolvedValue({ state: "error" });
    expect(await getPrfWrapSet()).toEqual({ state: "error" });
  });

  it("is absent on a healthy miss — never lured into a fresh empty write", async () => {
    mockRead.mockResolvedValue({ state: "absent" });
    expect(await getPrfWrapSet()).toEqual({ state: "absent" });
  });

  it("round-trips a stored set, read from the fixed path", async () => {
    mockRead.mockResolvedValue(okBytes(JSON.stringify(set)));
    expect(await getPrfWrapSet()).toEqual({ state: "ok", value: set });
    expect(mockRead).toHaveBeenCalledWith("meta/prfwrap");
  });

  it("treats malformed bytes as error, not absent", async () => {
    mockRead.mockResolvedValue(okBytes("{not json"));
    expect(await getPrfWrapSet()).toEqual({ state: "error" });
  });

  it("treats a shape-invalid object as error", async () => {
    mockRead.mockResolvedValue(okBytes(JSON.stringify({ v: 2, wraps: [] })));
    expect(await getPrfWrapSet()).toEqual({ state: "error" });
  });
});

describe("putPrfWrapSet", () => {
  it("overwrites at the fixed path and reports success", async () => {
    mockWrite.mockResolvedValue("ok");
    expect(await putPrfWrapSet(set)).toBe(true);
    expect(mockWrite).toHaveBeenCalledWith(
      "meta/prfwrap",
      JSON.stringify(set),
      {
        overwrite: true,
        contentType: "application/json",
      },
    );
  });

  it("reports false when the store is off or the write fails", async () => {
    mockWrite.mockResolvedValue("failed");
    expect(await putPrfWrapSet(set)).toBe(false);
  });
});
