import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendEntry, emptyLog, isAuthLog, type AuthLog } from "./authlog";
import { getAuthLog, putAuthLog, recordAuthEvent } from "./authlogstore";
import { r2Enabled, readKey, writeKey } from "./r2";

vi.mock("./r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2")>()),
  r2Enabled: vi.fn(),
  readKey: vi.fn(),
  writeKey: vi.fn(),
}));

const mockEnabled = vi.mocked(r2Enabled);
const mockRead = vi.mocked(readKey);
const mockWrite = vi.mocked(writeKey);

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

/** A real two-entry chain, built by the same core the store appends with. */
async function seededLog(): Promise<AuthLog> {
  let log = emptyLog();
  log = await appendEntry(log, {
    kind: "signin",
    detail: "iphone #cred-a",
    ts: "2026-07-16T00:00:00Z",
  });
  return appendEntry(log, {
    kind: "keystore",
    detail: "first-run setup",
    ts: "2026-07-16T00:01:00Z",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnabled.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAuthLog / putAuthLog", () => {
  it("decodes the stored bytes; put overwrites as JSON", async () => {
    mockRead.mockResolvedValue({ state: "ok", value: enc({ a: 1 }) });
    expect(await getAuthLog()).toEqual({ state: "ok", value: '{"a":1}' });

    mockWrite.mockResolvedValue("ok");
    expect(await putAuthLog("{}")).toBe(true);
    expect(mockWrite).toHaveBeenCalledWith("meta/authlog", "{}", {
      overwrite: true,
      contentType: "application/json",
    });
  });

  it("passes absent and error through untouched", async () => {
    mockRead.mockResolvedValue({ state: "absent" });
    expect(await getAuthLog()).toEqual({ state: "absent" });
    mockRead.mockResolvedValue({ state: "error" });
    expect(await getAuthLog()).toEqual({ state: "error" });
  });
});

describe("recordAuthEvent", () => {
  it("starts a fresh chain at seq 1 when the log is genuinely absent", async () => {
    mockRead.mockResolvedValue({ state: "absent" });
    mockWrite.mockResolvedValue("ok");

    await recordAuthEvent("signin", "iphone #cred-a");

    expect(mockWrite).toHaveBeenCalledTimes(1);
    const written: unknown = JSON.parse(mockWrite.mock.calls[0][1] as string);
    expect(isAuthLog(written)).toBe(true);
    const log = written as AuthLog;
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({
      seq: 1,
      kind: "signin",
      detail: "iphone #cred-a",
    });
  });

  it("appends seq n+1 to an existing chain, prior entries untouched", async () => {
    const prior = await seededLog();
    mockRead.mockResolvedValue({ state: "ok", value: enc(prior) });
    mockWrite.mockResolvedValue("ok");

    await recordAuthEvent("register", "yubikey #cred-b");

    const written = JSON.parse(mockWrite.mock.calls[0][1] as string) as AuthLog;
    expect(written.entries).toHaveLength(3);
    expect(written.entries[2]).toMatchObject({ seq: 3, kind: "register" });
    expect(written.entries.slice(0, 2)).toEqual(prior.entries);
  });

  it("NEVER writes off a read error — a flake restarting the chain would BE the truncation attack", async () => {
    mockRead.mockResolvedValue({ state: "error" });
    await recordAuthEvent("signin", "x");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("NEVER overwrites an unreadable log — a broken chain is evidence", async () => {
    mockRead.mockResolvedValue({
      state: "ok",
      value: new TextEncoder().encode("not json"),
    });
    await recordAuthEvent("signin", "x");
    expect(mockWrite).not.toHaveBeenCalled();

    mockRead.mockResolvedValue({ state: "ok", value: enc({ v: 99 }) });
    await recordAuthEvent("signin", "x");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("no-ops with the store off, and never throws on a write failure or an internal throw", async () => {
    mockEnabled.mockReturnValue(false);
    await expect(recordAuthEvent("signin", "x")).resolves.toBeUndefined();
    expect(mockRead).not.toHaveBeenCalled();

    mockEnabled.mockReturnValue(true);
    mockRead.mockResolvedValue({ state: "absent" });
    mockWrite.mockResolvedValue("failed");
    await expect(recordAuthEvent("signin", "x")).resolves.toBeUndefined();

    mockRead.mockRejectedValue(new Error("boom"));
    await expect(recordAuthEvent("signin", "x")).resolves.toBeUndefined();
  });
});
