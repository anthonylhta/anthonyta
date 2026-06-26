import { ContribGraph } from "@/components/terminal/ContribGraph";
import { relativeTime, type GithubStats } from "@/lib/github";
import { GITHUB_URL } from "@/lib/site";

/**
 * The lobby's "code" band — the live coding signal for recruiters (ADR 0042). A
 * full-width strip below the module grid: contributions + streak + repos, the
 * contribution heatmap, and the latest push. All public data.
 */
export function GithubModule({ gh }: { gh: GithubStats }) {
  const when = gh.recent ? relativeTime(gh.recent.at) : null;

  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="block border-t border-hairline px-4 py-4 transition-colors hover:bg-surface/30"
    >
      {/* header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-[11px] uppercase tracking-[0.2em] text-muted">
          <span className="h-2 w-2 rounded-full bg-up" />
          <span>code</span>
          <span className="normal-case tracking-normal text-muted/70">
            · github.com/{gh.login}
          </span>
        </div>
        <span className="text-xs text-amber">github ↗</span>
      </div>

      {/* stats */}
      <div className="mb-4 flex flex-wrap gap-x-10 gap-y-2">
        <Stat
          value={gh.contributions.toLocaleString()}
          sub="contributions · last year"
        />
        <Stat
          value={`${gh.currentStreak}d`}
          sub={`current streak · best ${gh.bestStreak}d`}
          amber
        />
        <Stat value={String(gh.publicRepos)} sub="public repos" />
      </div>

      {/* contribution heatmap */}
      <div>
        <ContribGraph weeks={gh.weeks} months={gh.months} />
      </div>

      {/* recent push */}
      {gh.recent && (
        <p className="mt-3 text-xs text-muted">
          ↻ pushed to {gh.login}/{gh.recent.repo}
          {when ? ` · ${when}` : ""}
          {gh.recent.lang ? ` · ${gh.recent.lang}` : ""}
        </p>
      )}
    </a>
  );
}

function Stat({
  value,
  sub,
  amber,
}: {
  value: string;
  sub: string;
  amber?: boolean;
}) {
  return (
    <div>
      <div
        className={`text-2xl tabular-nums ${amber ? "text-amber" : "text-fg"}`}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted">{sub}</div>
    </div>
  );
}
