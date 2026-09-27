import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { R2ListPage } from "./r2";
import {
  datedKey,
  KEEP_DAYS,
  runBackup,
  runSweep,
  sweepPlan,
  type BackupDeps,
  type BackupIndex,
} from "./backupcron";

/** A fake bucket: `pages` maps a list prefix to its pages, in order. */
function fakeDeps(pages: Record<string, R2ListPage[]>) {
  return {
    list: vi.fn<BackupDeps["list"]>(async (prefix, token) => {
      const p = pages[prefix] ?? [{ objects: [] }];
      return p[token ? Number(token) : 0];
    }),
    copy: vi.fn<BackupDeps["copy"]>(
      async () => new Response(null, { status: 200 }),
    ),
    del: vi.fn<BackupDeps["del"]>(
      async () => new Response(null, { status: 204 }),
    ),
    write: vi.fn<BackupDeps["write"]>(async () => "ok"),
  };
}

const obj = (key: string, size = 10) => ({
  key,
  size,
  lastModified: "2026-09-27T00:00:00Z",
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("datedKey", () => {
  it("nests the key under backup/<date>/", () => {
    expect(datedKey("2026-09-27", "meta/fin")).toBe(
      "backup/2026-09-27/meta/fin",
    );
  });
});

describe("sweepPlan", () => {
  const days = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`,
    );

  it("deletes nothing with fewer than keep dates", () => {
    expect(sweepPlan(days(3), 7)).toEqual([]);
  });

  it("deletes nothing with exactly keep dates", () => {
    expect(sweepPlan(days(7), 7)).toEqual([]);
  });

  it("deletes the oldest past keep", () => {
    expect(sweepPlan(days(9), 7)).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("sorts unsorted input before choosing", () => {
    expect(
      sweepPlan(["2026-09-10", "2026-08-31", "2026-09-02", "2026-09-05"], 2),
    ).toEqual(["2026-08-31", "2026-09-02"]);
  });
});

describe("runBackup", () => {
  it("copies every prefix across pages and writes the index", async () => {
    const deps = fakeDeps({
      "meta/": [
        { objects: [obj("meta/fin", 5)], next: "1" },
        { objects: [obj("meta/keystore", 7)] },
      ],
      "vault/": [{ objects: [obj("vault/a", 11)] }],
    });
    expect(await runBackup("2026-09-27", deps)).toEqual({
      copied: 3,
      failed: 0,
    });
    expect(deps.copy).toHaveBeenCalledWith(
      "meta/keystore",
      "backup/2026-09-27/meta/keystore",
    );
    expect(deps.copy).toHaveBeenCalledTimes(3);
    const [key, body, opts] = deps.write.mock.calls[0];
    expect(key).toBe("backup/2026-09-27/index.json");
    expect(opts).toEqual({ overwrite: true, contentType: "application/json" });
    const index = JSON.parse(body) as BackupIndex;
    expect(index).toMatchObject({ v: 1, count: 3, totalBytes: 23, failed: [] });
  });

  it("counts a failed copy without throwing and names it in the index", async () => {
    const deps = fakeDeps({
      "meta/": [{ objects: [obj("meta/fin"), obj("meta/keystore")] }],
    });
    deps.copy.mockImplementation(async (src: string) =>
      src === "meta/fin"
        ? new Response(null, { status: 500 })
        : new Response(null),
    );
    expect(await runBackup("2026-09-27", deps)).toEqual({
      copied: 1,
      failed: 1,
    });
    const index = JSON.parse(deps.write.mock.calls[0][1]) as BackupIndex;
    expect(index.failed).toEqual(["meta/fin"]);
    expect(index.count).toBe(1);
  });

  it("counts a thrown copy too", async () => {
    const deps = fakeDeps({ "inbox/": [{ objects: [obj("inbox/x")] }] });
    deps.copy.mockRejectedValue(new TypeError("fetch failed"));
    expect(await runBackup("2026-09-27", deps)).toEqual({
      copied: 0,
      failed: 1,
    });
  });

  it("never lists backup/ or touches the chores stamp", async () => {
    const deps = fakeDeps({ "meta/": [{ objects: [obj("meta/fin")] }] });
    await runBackup("2026-09-27", deps);
    expect(deps.list.mock.calls.map((c) => c[0])).toEqual([
      "meta/",
      "inbox/",
      "vault/",
    ]);
    expect(deps.write.mock.calls.map((c) => c[0])).toEqual([
      "backup/2026-09-27/index.json",
    ]);
  });
});

describe("runSweep", () => {
  it("deletes only objects under the doomed dates", async () => {
    const dates = Array.from(
      { length: KEEP_DAYS + 2 },
      (_, i) => `2026-09-${String(i + 10).padStart(2, "0")}`,
    );
    const objects = dates.flatMap((d) => [
      obj(`backup/${d}/meta/fin`),
      obj(`backup/${d}/index.json`),
    ]);
    const deps = fakeDeps({
      "backup/": [
        { objects: [...objects, obj("backup/notes.txt")], next: "1" },
        { objects: [obj("backup/2026-09-10/vault/a")] },
      ],
    });
    const result = await runSweep(deps);
    expect(result.dates.sort()).toEqual(["2026-09-10", "2026-09-11"]);
    expect(result.kept).toBe(KEEP_DAYS);
    expect(result.deleted).toBe(5);
    const gone = deps.del.mock.calls.map((c) => c[0]);
    expect(
      gone.every(
        (k) =>
          k.startsWith("backup/2026-09-10/") ||
          k.startsWith("backup/2026-09-11/"),
      ),
    ).toBe(true);
    expect(gone).toContain("backup/2026-09-10/vault/a");
  });

  it("deletes nothing while there are keep dates or fewer", async () => {
    const deps = fakeDeps({
      "backup/": [
        {
          objects: [
            obj("backup/2026-09-26/meta/fin"),
            obj("backup/2026-09-27/meta/fin"),
          ],
        },
      ],
    });
    expect(await runSweep(deps)).toEqual({ deleted: 0, dates: [], kept: 2 });
    expect(deps.del).not.toHaveBeenCalled();
  });
});
