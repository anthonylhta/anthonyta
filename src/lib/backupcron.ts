import { BACKUP_PREFIXES } from "./backup";
import {
  r2Copy,
  r2Delete,
  r2List,
  writeKey,
  type R2ListedObject,
  type R2ListPage,
  type StoreWrite,
} from "./r2";

/**
 * backupcron — the nightly in-bucket copy behind `/api/cron/backup`. R2 has no
 * object versioning, so until this existed the owner-run `npm run hub-backup`
 * was the ONLY version history. Each night every object under `BACKUP_PREFIXES`
 * is copied server-side to `backup/<date>/<key>`, then the oldest dated copies
 * are swept so the newest `KEEP_DAYS` remain.
 *
 * Invariants:
 *  - ciphertext copies as ciphertext: `r2Copy` is an S3 CopyObject, the bytes
 *    never leave the bucket and no key or passphrase is involved;
 *  - `backup/` sits outside `BACKUP_PREFIXES`, so a night never copies an
 *    earlier night (and the local `hub-backup` never downloads them either);
 *  - it never touches `meta/chores/backup` — that stamp means "the LOCAL,
 *    off-bucket copy ran", which an in-bucket copy does not replace (a bucket
 *    loss takes these copies with it);
 *  - a failed copy is counted and named in the night's `index.json`, never
 *    thrown — one bad object must not cost the other thousand;
 *  - the sweep deletes only whole `backup/<YYYY-MM-DD>/` dates outside the
 *    newest `KEEP_DAYS`; anything else under `backup/` is left alone.
 *
 * I/O arrives through `deps` so the tests drive it without a network.
 */

export const BACKUP_ROOT = "backup/";
export const KEEP_DAYS = 7;

const COPY_CONCURRENCY = 8;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface BackupDeps {
  list: (prefix: string, token?: string) => Promise<R2ListPage>;
  copy: (srcKey: string, destKey: string) => Promise<Response>;
  del: (key: string) => Promise<Response>;
  write: (
    key: string,
    body: string,
    opts: { overwrite: boolean; contentType: string },
  ) => Promise<StoreWrite>;
}

const r2Deps: BackupDeps = {
  list: r2List,
  copy: r2Copy,
  del: r2Delete,
  write: writeKey,
};

/** The night's index, written last under `backup/<date>/index.json`. */
export interface BackupIndex {
  v: 1;
  created: string;
  count: number;
  totalBytes: number;
  failed: string[];
}

export function datedKey(date: string, key: string): string {
  return `${BACKUP_ROOT}${date}/${key}`;
}

/** The dates to delete: everything but the newest `keep` (ISO dates sort lexically). */
export function sweepPlan(datePrefixes: string[], keep: number): string[] {
  const sorted = [...new Set(datePrefixes)].sort();
  return sorted.slice(0, Math.max(0, sorted.length - keep));
}

/** Every object under `prefix`, following continuation tokens. Throws on a failed page. */
async function listAll(
  prefix: string,
  deps: BackupDeps,
): Promise<R2ListedObject[]> {
  const out: R2ListedObject[] = [];
  let token: string | undefined;
  do {
    const page = await deps.list(prefix, token);
    out.push(...page.objects);
    token = page.next;
  } while (token);
  return out;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

/** Copy the estate to `backup/<date>/` and write the night's index. A failed
 *  list throws (nothing copied beats a night that silently skipped a prefix). */
export async function runBackup(
  date: string,
  deps: BackupDeps = r2Deps,
): Promise<{ copied: number; failed: number }> {
  const objects: R2ListedObject[] = [];
  for (const prefix of BACKUP_PREFIXES)
    objects.push(...(await listAll(prefix, deps)));

  let copied = 0;
  let totalBytes = 0;
  const failed: string[] = [];
  await pool(objects, COPY_CONCURRENCY, async (obj) => {
    try {
      const res = await deps.copy(obj.key, datedKey(date, obj.key));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      copied++;
      totalBytes += obj.size;
    } catch (err) {
      failed.push(obj.key);
      console.error("[cron:backup] copy failed:", obj.key, err);
    }
  });

  const index: BackupIndex = {
    v: 1,
    created: new Date().toISOString(),
    count: copied,
    totalBytes,
    failed,
  };
  const wrote = await deps.write(
    datedKey(date, "index.json"),
    JSON.stringify(index),
    { overwrite: true, contentType: "application/json" },
  );
  if (wrote !== "ok") console.error("[cron:backup] index write failed:", wrote);

  return { copied, failed: failed.length };
}

/** Delete every dated copy outside the newest `KEEP_DAYS`. `dates` names the
 *  swept dates, `kept` counts the dated copies left standing. */
export async function runSweep(
  deps: BackupDeps = r2Deps,
): Promise<{ deleted: number; dates: string[]; kept: number }> {
  const objects = await listAll(BACKUP_ROOT, deps);
  const dateOf = (key: string) => key.slice(BACKUP_ROOT.length).split("/")[0];
  const present = [
    ...new Set(
      objects.map((o) => dateOf(o.key)).filter((d) => DATE_RE.test(d)),
    ),
  ];
  const doomed = new Set(sweepPlan(present, KEEP_DAYS));

  let deleted = 0;
  await pool(
    objects.filter((o) => doomed.has(dateOf(o.key))),
    COPY_CONCURRENCY,
    async (obj) => {
      try {
        const res = await deps.del(obj.key);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        deleted++;
      } catch (err) {
        console.error("[cron:backup] delete failed:", obj.key, err);
      }
    },
  );

  return { deleted, dates: [...doomed], kept: present.length - doomed.size };
}
