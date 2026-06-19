import postgres from "postgres";
import type { Connector } from "./types";

/**
 * webnovel connector — reads my currently-reading list from the `webnovelist`
 * project's Supabase Postgres (ADR 0003, 0006).
 *
 * READ-ONLY by contract: the hub never writes to a project's DB. Only SELECTs
 * live here. Connects through webnovelist's transaction pooler with
 * `prepare: false` (pgbouncer-safe). Fully guarded — any failure or a missing
 * `WEBNOVEL_DATABASE_URL` (e.g. CI builds) returns `[]` so the page falls back
 * gracefully instead of throwing.
 */

export interface ReadingItem {
  title: string;
  chapter: number;
  total: number | null;
  updatedAt: string; // ISO date
}

type Row = {
  title: string;
  current_chapter: number;
  total_chapters: number | null;
  updated_at: string | Date;
};

const DEFAULT_USERNAME = process.env.WEBNOVEL_USERNAME ?? "mando";

let sql: ReturnType<typeof postgres> | null = null;
function client() {
  if (sql) return sql;
  const url = process.env.WEBNOVEL_DATABASE_URL;
  if (!url) return null;
  sql = postgres(url, {
    prepare: false,
    ssl: "require",
    max: 1,
    idle_timeout: 20,
  });
  return sql;
}

/** Currently-reading novels, most-recently-updated first. `[]` on any failure. */
export async function getCurrentlyReading(
  username: string = DEFAULT_USERNAME,
): Promise<ReadingItem[]> {
  const db = client();
  if (!db) return [];
  try {
    const rows = await db<Row[]>`
      select n.title,
             unl.current_chapter,
             n.total_chapters,
             unl.updated_at
      from user_novel_list unl
      join users u on u.id = unl.user_id
      join novels n on n.id = unl.novel_id
      where u.username = ${username}
        and unl.status = 'reading'
      order by unl.updated_at desc
    `;
    return rows.map((r) => ({
      title: r.title,
      chapter: Number(r.current_chapter),
      total: r.total_chapters == null ? null : Number(r.total_chapters),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  } catch (err) {
    console.error("[connector:webnovel] read failed:", err);
    return [];
  }
}

export const webnovel: Connector<ReadingItem[]> = {
  key: "webnovel",
  label: "reading",
  fetch: () => getCurrentlyReading(),
};
