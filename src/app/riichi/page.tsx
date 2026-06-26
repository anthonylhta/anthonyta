import Link from "next/link";
import { PuzzleCard } from "@/components/terminal/PuzzleCard";
import { SessionStatusBar } from "@/components/SessionStatusBar";
import { getHandOfTheDay, SAMPLE_PUZZLE } from "@/lib/connectors/riichi";

// SessionStatusBar reads the session, making this dynamic; the puzzle is the same
// daily row for everyone (ADR 0003, 0007).
export default async function RiichiPage() {
  const live = await getHandOfTheDay();
  const puzzle = live ?? SAMPLE_PUZZLE;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <SessionStatusBar />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">
            <span lang="ja" className="font-[family-name:var(--font-jp)]">
              本日の一手
            </span>{" "}
            · hand of the day
          </span>
          <span className="tabular-nums text-muted">
            {puzzle.isLive ? puzzle.date : "sample"}
          </span>
        </div>

        <div className="px-4 py-5">
          <PuzzleCard puzzle={puzzle} />
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        read-only from riichi · solve in the app, where your streak is tracked
      </p>
    </main>
  );
}
