import Link from "next/link";
import { Module } from "@/components/terminal/Module";
import { StatusBar } from "@/components/terminal/StatusBar";
import { Tape } from "@/components/terminal/Tape";
import { getBriefing } from "@/lib/connectors/briefing";
import { sampleBriefing } from "@/lib/sampleBriefing";

// Live from the Drive briefing; cached 10 min (ADR 0003, 0009).
export const revalidate = 600;

export default async function BriefingPage() {
  const b = (await getBriefing()) ?? sampleBriefing;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <StatusBar user="guest" />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">
            markets briefing
          </span>
          <span className="tabular-nums text-muted">
            {b.weekday} {b.date} · {b.generated}
          </span>
        </div>

        {/* tape */}
        <div className="border-b border-hairline px-4 py-4">
          <Tape items={b.tape} />
        </div>

        {/* what to watch */}
        {b.watch && b.watch.length > 0 && (
          <div className="border-b border-hairline px-4 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
              <span className="uppercase tracking-[0.2em] text-muted">
                ahead
              </span>
              {b.watch.map((w) => (
                <span key={w.label} className="whitespace-nowrap">
                  <span className="tabular-nums text-amber">{w.date}</span>{" "}
                  <span className="text-fg/80">{w.label}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* driving today */}
        <div className="border-b border-hairline px-4 py-4">
          <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
            driving today
          </p>
          <p className="text-sm text-fg/90">{b.summary}</p>
        </div>

        {/* bottom line */}
        <div className="border-b border-hairline px-4 py-4">
          <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
            bottom line
          </p>
          <ol className="space-y-2 text-sm">
            {b.bottomLine.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className="tabular-nums text-amber">{i + 1}</span>
                <span className="text-fg/90">{t}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* sections */}
        <div className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-3">
          {b.sections.map((s) => (
            <Module key={s.title} label={s.title} className="border-0">
              <ul className="space-y-2 text-xs">
                {s.points.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-amber">•</span>
                    <span className="text-fg/80">{p}</span>
                  </li>
                ))}
              </ul>
            </Module>
          ))}
        </div>

        {/* private — portfolio relevance (locked; never sent to the public page) */}
        <div className="border-t border-hairline px-4 py-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted">
            <span>portfolio relevance</span>
            <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-amber">
              🔒 private
            </span>
          </div>
          <div className="rounded border border-dashed border-hairline px-4 py-5 text-sm text-muted">
            How today maps to your portfolio — visible when you&apos;re signed
            in.
          </div>
        </div>

        {/* sources */}
        {b.sources && b.sources.length > 0 && (
          <div className="border-t border-hairline px-4 py-3">
            <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
              sources
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {b.sources.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-amber"
                >
                  {s.label} ↗
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        ingested daily via Google Drive
      </p>
    </main>
  );
}
