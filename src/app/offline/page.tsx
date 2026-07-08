import type { Metadata } from "next";
import Link from "next/link";

/**
 * The service worker serves this shell when a navigation fails with no network
 * (public/sw.js). Fully static and self-contained — it must render without any
 * connector call, since by definition there's no connection when it shows.
 */
export const metadata: Metadata = {
  title: "offline",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">offline</span>
          <span aria-hidden />
        </div>

        <div className="px-4 py-10">
          <p className="text-sm text-muted">
            <span className="text-amber">&gt;</span>{" "}
            <span className="cursor text-fg">no connection</span>
          </p>
          <p className="mt-3 text-sm text-fg/80">
            The hub couldn&apos;t reach the network. Pages you&apos;ve already
            opened stay available; live data resumes as soon as you&apos;re back
            online.
          </p>
          <p className="mt-6 text-xs text-muted">
            <Link href="/" className="text-amber hover:underline">
              retry the lobby
            </Link>
          </p>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}
