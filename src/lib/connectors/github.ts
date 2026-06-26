import { unstable_cache } from "next/cache";
import {
  sampleGithub,
  summarizeGithub,
  type GithubStats,
  type RawUser,
} from "@/lib/github";
import { GITHUB_LOGIN } from "@/lib/site";
import type { Connector } from "./types";

/**
 * github connector — the live coding signal for the recruiter audience (ADR 0042).
 * READ-ONLY, PUBLIC data only: contributions, streaks, top languages, recent push.
 *
 * One GraphQL call (the calendar needs GraphQL + a token) → `summarizeGithub`
 * (pure, in lib/github). Cached at the data layer (tag "github", 1h) so the lobby
 * never hits the API per request. Fully guarded: no `GITHUB_TOKEN` (CI) or any
 * failure → `sampleGithub`.
 */

const QUERY = `query($login:String!){
  user(login:$login){
    contributionsCollection{ contributionCalendar{ totalContributions
      weeks{ contributionDays{ contributionCount date } } } }
    repositories(first:100, privacy:PUBLIC, ownerAffiliations:OWNER, isFork:false,
      orderBy:{field:PUSHED_AT, direction:DESC}){
      totalCount
      nodes{ name pushedAt primaryLanguage{ name } }
    }
  }
}`;

async function fetchGithub(login: string): Promise<RawUser | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) {
    console.error("[connector:github] http", res.status);
    return null;
  }
  const json = (await res.json()) as {
    data?: { user?: RawUser | null };
    errors?: unknown;
  };
  if (json.errors) {
    console.error("[connector:github] graphql error", json.errors);
    return null;
  }
  return json.data?.user ?? null;
}

const load = unstable_cache(
  async (login: string): Promise<GithubStats> => {
    const user = await fetchGithub(login);
    return user ? summarizeGithub(user, login) : sampleGithub;
  },
  ["github"],
  { revalidate: 3600, tags: ["github"] },
);

/** Public GitHub activity for the lobby. Falls back to sample on no token / failure. */
export async function getGithub(): Promise<GithubStats> {
  const login =
    process.env.GITHUB_LOGIN ?? process.env.OWNER_GITHUB_LOGIN ?? GITHUB_LOGIN;
  if (!process.env.GITHUB_TOKEN) return sampleGithub;
  try {
    return await load(login);
  } catch (err) {
    console.error("[connector:github] read failed:", err);
    return sampleGithub;
  }
}

export const github: Connector<GithubStats> = {
  key: "github",
  label: "code",
  fetch: () => getGithub(),
};
