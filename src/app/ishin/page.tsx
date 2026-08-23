import Link from "next/link";
import { auth } from "@/auth";
import { StatusBar } from "@/components/terminal/StatusBar";
import {
  getLanguageStats,
  getRecentTranslations,
} from "@/lib/connectors/translator";

// The tones the product currently offers (ishin ADR 0051 trimmed the set to
// these two). Mirrored here as a constant — the same hand-sync ishin's own
// dropdown lives with — so retired tones' historical rows never resurface on
// this page. They still count toward the lifetime total; they just aren't
// listed as if they were still on the menu.
const CURRENT_TONES = ["casual", "polite"] as const;

// Ishin's own seal colors (its favicon), quoted verbatim. The one deliberate
// foreign color on the page: a case study wears its subject's mark the way it
// would show a screenshot. Everything interactive stays amber.
const SEAL_BG = "#C0392B";
const SEAL_INK = "#0D0D0B";

const EXT = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

// Public case-study surface for everyone; the recent feed is owner-only — it's
// only fetched when signed in, so a guest's HTML never contains my translation
// text. Guests also see NO trace of the section (no "private" badge, no "sign
// in" prompt) — the public face must never reveal that a logged-in mode exists
// (ADR 0022). Reading the session makes this dynamic; the data is cached at
// the connector (tag "translator", ADR 0014, 0016).
export default async function IshinPage() {
  const [session, stats] = await Promise.all([auth(), getLanguageStats()]);
  const isOwner = !!session?.user;
  const recent = isOwner ? await getRecentTranslations(6) : [];
  const maxDay = Math.max(1, ...stats.recentDays.map((d) => d.count));

  const tones = CURRENT_TONES.map((tone) => {
    const count = stats.tones.find((t) => t.tone === tone)?.count ?? 0;
    const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
    return { tone, pct };
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar
          user={isOwner ? (session?.user?.name ?? "anthony") : "guest"}
        />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">
            ishin 以心
          </span>
          <a
            href="https://ishin.io"
            {...EXT}
            className="text-amber hover:underline"
          >
            ishin.io ↗
          </a>
        </div>

        {/* hero — what ishin is, in its own words */}
        <div className="border-b border-hairline px-4 py-4">
          <div className="flex items-start gap-4">
            <span
              lang="ja"
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[3px] text-center font-[family-name:var(--font-jp)] text-[22px] leading-[1.05]"
              style={{ backgroundColor: SEAL_BG, color: SEAL_INK }}
            >
              以
              <br />心
            </span>
            <div>
              <h1 className="text-[15px] font-semibold">
                Japanese ⇄ English that lands as meant
              </h1>
              <p className="mt-1 text-[13px] leading-relaxed text-fg">
                Translation where the unsaid part — register, cushioning,
                distance — survives the trip.
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                from{" "}
                <span lang="ja" className="font-[family-name:var(--font-jp)]">
                  以心伝心
                </span>{" "}
                — understanding without words · live at{" "}
                <a
                  href="https://ishin.io"
                  {...EXT}
                  className="text-amber hover:underline"
                >
                  ishin.io
                </a>
              </p>
            </div>
          </div>
        </div>

        {/* two faces — the product's own homepage split, doors out */}
        <div className="border-b border-hairline px-4 py-4">
          <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">
            two faces
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="border border-hairline bg-surface/20 p-3">
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
                personal
              </span>
              <span className="ml-2 border border-hairline px-1.5 py-px text-[10px] tracking-wide text-muted">
                free
              </span>
              <p className="mt-1.5 text-[13px]">The daily driver</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                The fastest natural casual JP⇄EN translator — for chatting with
                friends. Naturalness beats literal; casual first, polite when it
                matters.
              </p>
              <a
                href="https://ishin.io/personal"
                {...EXT}
                className="mt-2.5 block text-xs text-amber hover:underline"
              >
                open the translator →
              </a>
            </div>
            <div className="border border-hairline bg-surface/20 p-3">
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
                business
              </span>
              <span className="ml-2 border border-hairline px-1.5 py-px text-[10px] tracking-wide text-muted">
                early access
              </span>
              <p className="mt-1.5 text-[13px]">Messages that land wrong</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Grammatically perfect can still be culturally wrong — the
                missing cushion before a refusal, the misread soft no. Ishin
                catches it before your client does.
              </p>
              <a
                href="https://ishin.io/business"
                {...EXT}
                className="mt-2.5 block text-xs text-amber hover:underline"
              >
                join the waitlist →
              </a>
            </div>
          </div>
        </div>

        {/* live band — the connector's aggregates; honest label when sampled */}
        <div className="border-b border-hairline px-4 py-4">
          <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">
            {stats.isLive ? "live from the product" : "sample data"}
          </p>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
            <span className="text-[22px] tabular-nums">
              {stats.total}
              <span className="ml-1.5 text-xs text-muted">translations</span>
            </span>
            <span className="text-xs tabular-nums text-muted">
              <span className="text-fg">{stats.translations}</span> translate /{" "}
              <span className="text-fg">{stats.checks}</span> check
            </span>
            <span className="text-xs tabular-nums text-muted">
              <span className="text-fg">{stats.thisWeek}</span> this week
            </span>
            <span className="text-xs tabular-nums text-muted">
              <span className="text-fg">{stats.streakDays}d</span> streak
            </span>
          </div>
          <div className="mt-3 flex h-12 items-end gap-1">
            {stats.recentDays.map((d) => (
              <div
                key={d.date}
                className="flex-1"
                title={`${d.date}: ${d.count}`}
              >
                <div
                  className="bg-amber/70"
                  style={{
                    height: `${Math.round((d.count / maxDay) * 100)}%`,
                    minHeight: d.count > 0 ? "2px" : undefined,
                  }}
                />
              </div>
            ))}
          </div>
          <p className="mt-1 text-right text-[10px] text-muted/60">
            last 14 days
          </p>
          <p className="mt-2 text-xs tabular-nums text-muted">
            tone ·{" "}
            {tones.map((t, i) => (
              <span key={t.tone}>
                {i > 0 && " / "}
                <span className={i === 0 ? "text-fg" : undefined}>
                  {t.tone} {t.pct}%
                </span>
              </span>
            ))}
          </p>
        </div>

        {/* how it's built — architectural only (ADR 0022): patterns and stack,
            no prompts or ruleset detail (the business IP boundary), model
            names generalized so the page doesn't rot when the pair changes */}
        <div
          className={`px-4 py-4${isOwner ? " border-b border-hairline" : ""}`}
        >
          <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">
            how it&apos;s built
          </p>
          <ul className="flex flex-col gap-1.5">
            {[
              [
                "Per-direction models",
                "a fast model EN→JP, a stronger one JP→EN, both streaming.",
              ],
              [
                "Naturalness check",
                "a second mode verdicts your own JP or EN: ✓ natural / ⚠ with a fix.",
              ],
              [
                "Hardened prompts",
                "injection-resistant, snapshot-tested so a stray edit fails CI.",
              ],
              [
                "Golden-case evals",
                "every field bug becomes a permanent regression case.",
              ],
              [
                "Next.js · Clerk · Supabase",
                "installable PWA with a hand-rolled service worker.",
              ],
            ].map(([lead, rest]) => (
              <li
                key={lead}
                className="relative pl-3.5 text-xs leading-relaxed text-muted"
              >
                <span className="absolute left-0 text-amber">·</span>
                <span className="text-fg">{lead}</span> — {rest}
              </li>
            ))}
          </ul>
        </div>

        {/* recent — owner-only; guests see no trace of it at all (ADR 0022) */}
        {isOwner && (
          <div className="px-4 py-4">
            <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted">
              <span>recent</span>
              <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-amber">
                private
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {recent.map((t, i) => (
                <li
                  key={i}
                  className="border border-hairline bg-surface/20 px-3 py-2 text-sm"
                >
                  <p className="text-muted">{t.userText}</p>
                  <p
                    lang="ja"
                    className="font-[family-name:var(--font-jp)] text-fg"
                  >
                    {t.assistantText}
                  </p>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                    {t.tone && <span className="text-amber">{t.tone}</span>}
                    {t.explanation && (
                      <span className="text-muted/80">— {t.explanation}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        ishin · Japanese ⇄ English that lands as meant · casual → keigo
      </p>
    </main>
  );
}
