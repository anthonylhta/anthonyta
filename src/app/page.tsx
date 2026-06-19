import Link from "next/link";
import { Bar } from "@/components/terminal/Bar";
import { CommandPalette } from "@/components/terminal/CommandPalette";
import { Module } from "@/components/terminal/Module";
import { StatusBar } from "@/components/terminal/StatusBar";
import { getCurrentlyReading } from "@/lib/connectors/webnovel";
import {
  briefing,
  me,
  nav,
  now,
  reading as mockReading,
  riichi,
} from "@/lib/mock";

// Reading is live from webnovelist's Supabase; cache for 10 min (ADR 0003, 0006).
export const revalidate = 600;

export default async function Home() {
  const reads = await getCurrentlyReading();
  const top = reads[0];
  const reading = top
    ? {
        title: top.title,
        chapter: top.chapter,
        total: top.total ?? 0,
        count: reads.length,
      }
    : {
        title: mockReading.title,
        chapter: mockReading.chapter,
        total: mockReading.total,
        count: 1,
      };

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user="guest" />

        {/* prompt / hero */}
        <div className="border-b border-hairline px-4 py-6">
          <p className="text-sm text-muted">
            <span className="text-amber">&gt;</span>{" "}
            <span className="cursor text-fg">{me.tagline}</span>
          </p>
        </div>

        {/* module grid */}
        <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-3">
          <Module label="now" className="border-0">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-muted">jp streak</span>
                <span className="tabular-nums text-fg">
                  {now.jpStreakDays}d
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted">build</span>
                <Bar value={now.build.value} max={now.build.max} width={6} />
              </div>
            </div>
          </Module>

          <Module label="reading" className="border-0">
            <div className="space-y-2">
              <p className="line-clamp-2 text-fg">{reading.title}</p>
              <p className="text-xs text-muted">
                ch. {reading.chapter}
                {reading.total ? `/${reading.total}` : ""}
                {reading.count > 1 ? ` · ${reading.count} in progress` : ""}
              </p>
              {reading.total ? (
                <Bar value={reading.chapter} max={reading.total} width={8} />
              ) : null}
            </div>
          </Module>

          <Module
            label="riichi"
            className="border-0"
            action={
              <Link
                href="/riichi"
                className="text-xs text-amber hover:underline"
              >
                [solve]
              </Link>
            }
          >
            <div className="space-y-1">
              <p className="text-muted">
                hand <span className="text-fg">#{riichi.handNo}</span>
              </p>
              <p className="text-xs text-muted">
                <span lang="ja" className="font-[family-name:var(--font-jp)]">
                  本日の一手
                </span>{" "}
                — {riichi.solved ? "solved ✓" : "unsolved"}
              </p>
            </div>
          </Module>
        </div>

        {/* briefing */}
        <div className="border-t border-hairline px-4 py-4">
          <div className="mb-2 flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-muted">
            <span>briefing</span>
            <span className="h-px flex-1 bg-hairline" />
            <span className="tabular-nums">{briefing.date}</span>
          </div>
          <ul className="space-y-1 text-sm">
            {briefing.items.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-amber">•</span>
                <span className="text-fg/90">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* nav */}
        <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
          <nav className="flex gap-4 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted transition-colors hover:text-amber"
              >
                {item.label}/
              </Link>
            ))}
          </nav>
          <CommandPalette
            items={[
              ...nav.map((n) => ({ label: n.label, href: n.href })),
              { label: "today's hand", href: "/riichi", hint: "riichi" },
            ]}
          />
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        warm terminal · reading is live · more connectors next
      </p>
    </main>
  );
}
