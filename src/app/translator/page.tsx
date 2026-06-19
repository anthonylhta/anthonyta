import Link from "next/link";
import { auth } from "@/auth";
import { Bar } from "@/components/terminal/Bar";
import { StatusBar } from "@/components/terminal/StatusBar";
import {
  getLanguageStats,
  getRecentTranslations,
} from "@/lib/connectors/translator";

// Public tone/activity stats for everyone; the recent feed is owner-only — it's
// only fetched when signed in, so a guest's HTML never contains my translation
// text. Reading the session makes this dynamic; the data is cached at the
// connector (tag "translator", ADR 0014, 0016).
export default async function TranslatorPage() {
  const [session, stats] = await Promise.all([auth(), getLanguageStats()]);
  const isOwner = !!session?.user;
  const recent = isOwner ? await getRecentTranslations(10) : [];
  const maxDay = Math.max(1, ...stats.recentDays.map((d) => d.count));

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
            tone translator
          </span>
          <span className="tabular-nums text-muted">
            <span lang="ja" className="font-[family-name:var(--font-jp)]">
              日本語
            </span>{" "}
            · {stats.total} translations
          </span>
        </div>

        {/* tone mix — public */}
        <div className="border-b border-hairline px-4 py-4">
          <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">
            tone mix
          </p>
          <div className="space-y-2">
            {stats.tones.map((t) => (
              <div key={t.tone} className="flex items-center gap-3 text-sm">
                <span className="w-14 shrink-0 text-fg/90">{t.tone}</span>
                <Bar value={t.count} max={stats.total} width={16} />
                <span className="tabular-nums text-muted">{t.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* activity — public */}
        <div className="border-b border-hairline px-4 py-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
              activity
            </p>
            <p className="tabular-nums text-xs text-muted">
              {stats.streakDays}d streak · {stats.thisWeek} this week ·{" "}
              {stats.translations} translate / {stats.checks} check
            </p>
          </div>
          <div className="flex h-12 items-end gap-1">
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
        </div>

        {/* recent — owner-only */}
        <div className="px-4 py-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted">
            <span>recent</span>
            <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-amber">
              {isOwner ? "private" : "🔒 private"}
            </span>
          </div>
          {isOwner ? (
            <ul className="space-y-2">
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
          ) : (
            <div className="rounded border border-dashed border-hairline px-4 py-5 text-sm text-muted">
              My translations — visible when you&apos;re signed in.
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        a tone-aware Japanese translator · casual → keigo
      </p>
    </main>
  );
}
