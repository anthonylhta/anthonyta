import { updatedLabel, type NowConfig } from "@/lib/now";

/**
 * The front door's "now" block — what I am doing at the moment, in a few keyed
 * lines, above everything else the lobby has to say (ADR 0004's audience: a
 * recruiter who gives the page one screen). The words come from the owner's
 * plaintext store (lib/now), so they move without a deploy; the stamp says which
 * Sydney day they last moved, because a stale now block is worse than none.
 *
 * Every line renders as TEXT, never markup: the store is edited from a panel and
 * a palette, and nothing typed into either should be able to reach the DOM as
 * anything but words.
 */
export function NowCard({ now }: { now: NowConfig }) {
  if (now.lines.length === 0) return null;

  return (
    <div className="border-b border-hairline px-5 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-[0.22em] text-muted/70">
          now
        </span>
        <span className="text-[10px] tabular-nums text-muted/50">
          {updatedLabel(now.updatedAt)}
        </span>
      </div>
      <div className="space-y-3">
        {now.lines.map((line) => (
          <div key={line.key} className="flex items-baseline gap-5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted">
              {line.key}
            </span>
            <span className="min-w-0 text-sm leading-relaxed text-fg/90">
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
