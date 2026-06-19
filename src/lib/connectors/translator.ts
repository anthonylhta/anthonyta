import { unstable_cache } from "next/cache";
import postgres from "postgres";
import type { Connector } from "./types";

/**
 * translator connector — reads my Japanese tone-translator (Supabase) usage stats
 * (ADR 0003, 0015). READ-ONLY: SELECTs only; the hub never writes to a project DB.
 *
 * Scoped by EMAIL, not user_id: my history is split across two Clerk user_ids under
 * the same email (a re-auth artifact), so the connector joins `users` by email to
 * capture all of it. Only AGGREGATES (counts, tone mix, streak) leave this module —
 * the raw user_text / assistant_text are never returned — so the public lobby is safe.
 *
 * Cached at the data layer (tag "translator") like the briefing (ADR 0014). Fully
 * guarded: missing TRANSLATOR_DATABASE_URL / TRANSLATOR_EMAIL (e.g. CI) → sample.
 */

export interface ToneCount {
  tone: string;
  count: number;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface LanguageStats {
  /** lifetime messages (both of my accounts) */
  total: number;
  /** message_type = 'translation' */
  translations: number;
  /** message_type = 'check' (verify / correct my JP) */
  checks: number;
  /** messages in the last 7 days */
  thisWeek: number;
  /** consecutive Sydney days with >=1 message, ending today or yesterday */
  streakDays: number;
  /** ISO of the most recent message, or null */
  lastActive: string | null;
  /** tone distribution, most-used first */
  tones: ToneCount[];
  /** the most-used tone, or null */
  topTone: string | null;
  /** per-day message counts, last 14 days, oldest → newest (zero-filled) */
  recentDays: DayCount[];
  /** false when served from SAMPLE (creds not set / read failed) */
  isLive: boolean;
}

/** Shown when the connector can't reach the source (no creds, CI). Not real data. */
export const sampleLanguageStats: LanguageStats = {
  total: 128,
  translations: 104,
  checks: 24,
  thisWeek: 11,
  streakDays: 3,
  lastActive: null,
  tones: [
    { tone: "casual", count: 116 },
    { tone: "polite", count: 6 },
    { tone: "formal", count: 4 },
    { tone: "blunt", count: 2 },
  ],
  topTone: "casual",
  recentDays: sampleSeries(),
  isLive: false,
};

type Row = {
  message_type: string;
  tone: string | null;
  created_at: string | Date;
};

let sql: ReturnType<typeof postgres> | null = null;
function client() {
  if (sql) return sql;
  const url = process.env.TRANSLATOR_DATABASE_URL;
  if (!url) return null;
  sql = postgres(url, {
    prepare: false,
    ssl: "require",
    max: 1,
    idle_timeout: 20,
  });
  return sql;
}

/** YYYY-MM-DD on the Sydney calendar day. */
function sydneyDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(d);
}

/** The calendar day before `ymd` (date math on UTC midnight — DST-safe). */
function prevDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Last `n` days of counts, oldest → newest, zero-filled. */
function lastNDays(counts: Map<string, number>, n: number): DayCount[] {
  let cursor = sydneyDay(new Date());
  const out: DayCount[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ date: cursor, count: counts.get(cursor) ?? 0 });
    cursor = prevDay(cursor);
  }
  return out.reverse();
}

/** A believable 14-day sparkline for the sample (relative to today). */
function sampleSeries(): DayCount[] {
  const pattern = [1, 0, 2, 3, 1, 4, 2, 0, 1, 3, 5, 2, 1, 3];
  const counts = new Map<string, number>();
  let cursor = sydneyDay(new Date());
  for (let i = 0; i < 14; i++) {
    counts.set(cursor, pattern[i] ?? 0);
    cursor = prevDay(cursor);
  }
  return lastNDays(counts, 14);
}

/** Consecutive active days, counting back from today (a streak still counts if the
 *  last active day was yesterday). */
function computeStreak(days: Set<string>, today: string): number {
  let cursor = today;
  if (!days.has(cursor)) {
    cursor = prevDay(cursor);
    if (!days.has(cursor)) return 0;
  }
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = prevDay(cursor);
  }
  return streak;
}

function summarize(rows: Row[]): LanguageStats {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const toneCounts = new Map<string, number>();
  const dayCounts = new Map<string, number>();
  let translations = 0;
  let checks = 0;
  let thisWeek = 0;
  let lastMs = 0;

  for (const r of rows) {
    const at = new Date(r.created_at);
    const ms = at.getTime();
    if (ms > lastMs) lastMs = ms;
    if (ms >= weekAgo) thisWeek++;
    if (r.message_type === "translation") translations++;
    else if (r.message_type === "check") checks++;
    if (r.tone) toneCounts.set(r.tone, (toneCounts.get(r.tone) ?? 0) + 1);
    const day = sydneyDay(at);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  const tones = [...toneCounts.entries()]
    .map(([tone, count]) => ({ tone, count }))
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    translations,
    checks,
    thisWeek,
    streakDays: computeStreak(new Set(dayCounts.keys()), sydneyDay(new Date())),
    lastActive: lastMs ? new Date(lastMs).toISOString() : null,
    tones,
    topTone: tones[0]?.tone ?? null,
    recentDays: lastNDays(dayCounts, 14),
    isLive: true,
  };
}

/** Cached data-layer read (ADR 0014). Keyed by email; refreshable via tag. */
const readStats = unstable_cache(
  async (email: string): Promise<LanguageStats> => {
    const db = client();
    if (!db) return sampleLanguageStats;
    const rows = await db<Row[]>`
      select t.message_type, t.tone, t.created_at
      from translations t
      join users u on u.id = t.user_id
      where u.email = ${email}
    `;
    return summarize(rows);
  },
  ["translator-stats"],
  { revalidate: 600, tags: ["translator"] },
);

/** My tone-translator usage. Falls back to sample on missing creds / any failure. */
export async function getLanguageStats(): Promise<LanguageStats> {
  const email = process.env.TRANSLATOR_EMAIL;
  if (!email || !process.env.TRANSLATOR_DATABASE_URL) {
    return sampleLanguageStats;
  }
  try {
    return await readStats(email);
  } catch (err) {
    console.error("[connector:translator] read failed:", err);
    return sampleLanguageStats;
  }
}

/** One saved translation. PRIVATE — contains my own text. */
export interface TranslationItem {
  userText: string;
  assistantText: string;
  tone: string | null;
  explanation: string | null;
  createdAt: string;
}

type RecentRow = {
  user_text: string;
  assistant_text: string;
  tone: string | null;
  explanation: string | null;
  created_at: string | Date;
};

/** Sample feed for the owner view when creds aren't set. Not real. */
export const sampleRecent: TranslationItem[] = [
  {
    userText: "let's grab food after this",
    assistantText: "この後ご飯食べに行こう",
    tone: "casual",
    explanation:
      "〜に行こう is the casual volitional — natural between friends.",
    createdAt: new Date().toISOString(),
  },
  {
    userText: "Could you send the report by end of day?",
    assistantText: "本日中にレポートをお送りいただけますか？",
    tone: "polite",
    explanation: "お送りいただけますか keeps it a polite request.",
    createdAt: new Date().toISOString(),
  },
];

const readRecent = unstable_cache(
  async (email: string, limit: number): Promise<TranslationItem[]> => {
    const db = client();
    if (!db) return sampleRecent;
    const rows = await db<RecentRow[]>`
      select t.user_text, t.assistant_text, t.tone, t.explanation, t.created_at
      from translations t
      join users u on u.id = t.user_id
      where u.email = ${email}
      order by t.created_at desc
      limit ${limit}
    `;
    return rows.map((r) => ({
      userText: r.user_text,
      assistantText: r.assistant_text,
      tone: r.tone,
      explanation: r.explanation,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  },
  ["translator-recent"],
  { revalidate: 300, tags: ["translator"] },
);

/**
 * Owner-only recent feed — contains my raw text, so the CALLER must gate this on
 * auth (the /translator page only calls it when signed in). Guarded → sample.
 */
export async function getRecentTranslations(
  limit = 10,
): Promise<TranslationItem[]> {
  const email = process.env.TRANSLATOR_EMAIL;
  if (!email || !process.env.TRANSLATOR_DATABASE_URL) return sampleRecent;
  try {
    return await readRecent(email, limit);
  } catch (err) {
    console.error("[connector:translator] recent read failed:", err);
    return sampleRecent;
  }
}

export const translator: Connector<LanguageStats> = {
  key: "translator",
  label: "languages",
  fetch: () => getLanguageStats(),
};
