import postgres from "postgres";

/**
 * weekly-snapshot store — the hub's FIRST write store (ADR 0033).
 *
 * Every connector is read-only against a *project's* DB (ADR 0003), and no source
 * keeps the week-ago baseline a true week-over-week delta needs. So the hub owns one
 * tiny table in its OWN Neon DB (`HUB_DATABASE_URL`) and writes a daily snapshot of
 * net worth + total reading chapters via cron; the command center diffs today against
 * the row from ~7 days ago. This never touches a project DB — the read-only connector
 * contract stays intact.
 *
 * Fully guarded: no `HUB_DATABASE_URL` (local dev, CI) → writes no-op, reads return
 * `null`, and every caller falls back to current-state display. The snapshot cron only
 * runs on Vercel, so the local WSL/Neon IPv6 `fetch failed` trap doesn't apply here.
 */

export interface Snapshot {
  netWorthCents: number;
  readingChapters: number;
}

let sql: ReturnType<typeof postgres> | null = null;
function client() {
  if (sql) return sql;
  const url = process.env.HUB_DATABASE_URL;
  if (!url) return null;
  sql = postgres(url, {
    prepare: false,
    ssl: "require",
    max: 1,
    idle_timeout: 20,
  });
  return sql;
}

/** Create the one table on first write — the hub has no migration tooling, and one
 *  `create table if not exists` keeps the whole feature self-bootstrapping. */
async function ensureTable(db: ReturnType<typeof postgres>): Promise<void> {
  await db`
    create table if not exists weekly_snapshot (
      taken_on         date primary key,
      net_worth_cents  bigint not null,
      reading_chapters integer not null,
      created_at       timestamptz not null default now()
    )
  `;
}

/** Idempotent upsert of one day's snapshot, keyed by the Sydney calendar date — a
 *  same-day re-run overwrites rather than duplicates. `false` when the store is off. */
export async function writeSnapshot(
  date: string,
  s: Snapshot,
): Promise<boolean> {
  const db = client();
  if (!db) return false;
  try {
    await ensureTable(db);
    await db`
      insert into weekly_snapshot (taken_on, net_worth_cents, reading_chapters)
      values (${date}, ${s.netWorthCents}, ${s.readingChapters})
      on conflict (taken_on) do update set
        net_worth_cents  = excluded.net_worth_cents,
        reading_chapters = excluded.reading_chapters
    `;
    return true;
  } catch (err) {
    console.error("[snapshots] write failed:", err);
    return false;
  }
}

/**
 * The most recent snapshot on or before ~`days` ago — the baseline a delta diffs
 * against. `null` when no history reaches back that far yet (the first week), the
 * store is off, or the table doesn't exist (before the cron's first run). The cutoff
 * is reckoned on the Sydney calendar so it lines up with how snapshots are keyed.
 */
export async function getBaseline(days = 7): Promise<Snapshot | null> {
  const db = client();
  if (!db) return null;
  const cutoff = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date(Date.now() - days * 86_400_000));
  try {
    const rows = await db<Snapshot[]>`
      select net_worth_cents  as "netWorthCents",
             reading_chapters as "readingChapters"
      from weekly_snapshot
      where taken_on <= ${cutoff}
      order by taken_on desc
      limit 1
    `;
    return rows[0] ?? null;
  } catch (err) {
    console.error("[snapshots] baseline read failed:", err);
    return null;
  }
}
