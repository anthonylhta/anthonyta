import { GITHUB_LOGIN } from "./site";

/**
 * Pure GitHub transforms + types — the GraphQL payload → the normalized shape the
 * lobby renders (ADR 0042). Kept free of any `next` import so it's unit-testable on
 * its own (mirrors lib/portfolio vs connectors/portfolio); the connector
 * (connectors/github) wraps these around the fetch + cache.
 */

export interface GithubStats {
  login: string;
  /** total contributions in the trailing year */
  contributions: number;
  currentStreak: number;
  bestStreak: number;
  publicRepos: number;
  /** contribution levels 0–4, [week][day], oldest → newest (weeks may be ragged) */
  weeks: number[][];
  /** month labels keyed to the week index where each month starts */
  months: { label: string; week: number }[];
  /** most-recently-pushed public repo */
  recent: { repo: string; lang: string | null; at: string } | null;
  /** false when served from SAMPLE (no token / read failed) */
  isLive: boolean;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]; // prettier-ignore

/** A contribution count → a 0–4 intensity bucket, scaled to the busiest day. */
export function contribLevel(count: number, max: number): number {
  if (count <= 0) return 0;
  const r = count / Math.max(1, max);
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

/** Current + best run of consecutive days with ≥1 contribution. `counts` is oldest →
 *  newest; a still-empty today (the final day) doesn't break the current streak. */
export function streaks(counts: number[]): {
  currentStreak: number;
  bestStreak: number;
} {
  let best = 0;
  let run = 0;
  for (const c of counts) {
    run = c > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  let i = counts.length - 1;
  if (i >= 0 && counts[i] === 0) i--; // today, not committed yet — don't reset
  let current = 0;
  while (i >= 0 && counts[i] > 0) {
    current++;
    i--;
  }
  return { currentStreak: current, bestStreak: best };
}

export type Repo = {
  name: string;
  pushedAt: string;
  primaryLanguage: { name: string } | null;
};

type CalDay = { contributionCount: number; date: string };
type CalWeek = { contributionDays: CalDay[] };
export type RawUser = {
  contributionsCollection: {
    contributionCalendar: { totalContributions: number; weeks: CalWeek[] };
  };
  repositories: { totalCount: number; nodes: Repo[] };
};

/** A month label at every week where the calendar rolls into a new month. */
function monthLabels(weeks: CalWeek[]): { label: string; week: number }[] {
  const out: { label: string; week: number }[] = [];
  let last = "";
  weeks.forEach((w, i) => {
    const first = w.contributionDays[0];
    if (!first) return;
    const mm = first.date.slice(5, 7);
    if (mm !== last) {
      last = mm;
      out.push({ label: MONTHS[Number(mm) - 1] ?? "", week: i });
    }
  });
  return out;
}

/** GraphQL `user` payload → the normalized shape the module renders. */
export function summarizeGithub(user: RawUser, login: string): GithubStats {
  const cal = user.contributionsCollection.contributionCalendar;
  const counts = cal.weeks.flatMap((w) =>
    w.contributionDays.map((d) => d.contributionCount),
  );
  const max = Math.max(1, ...counts);
  const weeks = cal.weeks.map((w) =>
    w.contributionDays.map((d) => contribLevel(d.contributionCount, max)),
  );
  const top = user.repositories.nodes[0] ?? null;
  return {
    login,
    contributions: cal.totalContributions,
    ...streaks(counts),
    publicRepos: user.repositories.totalCount,
    weeks,
    months: monthLabels(cal.weeks),
    recent: top
      ? {
          repo: top.name,
          lang: top.primaryLanguage?.name ?? null,
          at: top.pushedAt,
        }
      : null,
    isLive: true,
  };
}

/** "2h ago" / "3d ago" / "just now" from an ISO timestamp. `""` → null. */
export function relativeTime(
  iso: string,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

// ── sample fallback (deterministic, so it doesn't flicker between requests) ───

function sampleWeeks(): number[][] {
  const weeks: number[][] = [];
  for (let w = 0; w < 53; w++) {
    const col: number[] = [];
    for (let d = 0; d < 7; d++) {
      const seed = ((w * 7 + d) * 2654435761) % 101;
      const weekend = d === 0 || d === 6;
      let lvl = seed % 5;
      if (weekend && lvl > 0) lvl = Math.max(0, lvl - 2);
      if (w > 49) lvl = 2 + (seed % 3); // recent streak runs hot
      col.push(Math.min(4, lvl));
    }
    weeks.push(col);
  }
  return weeks;
}

/** Shown when GITHUB_TOKEN isn't set (CI, local) or a read fails. Not real data. */
export const sampleGithub: GithubStats = {
  login: GITHUB_LOGIN,
  contributions: 1788,
  currentStreak: 18,
  bestStreak: 73,
  publicRepos: 14,
  weeks: sampleWeeks(),
  months: [
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
  ].map((label, i) => ({ label, week: Math.round((i * 53) / 12) })),
  recent: { repo: "anthonyta", lang: "TypeScript", at: "" },
  isLive: false,
};
