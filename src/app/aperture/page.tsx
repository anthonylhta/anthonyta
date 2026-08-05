import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { ApertureInner } from "@/components/ApertureInner";
import { StatusBar } from "@/components/terminal/StatusBar";
import { essenceOf } from "@/lib/aperture";
import {
  essenceTextClass,
  essenceVarClass,
  membraneOf,
} from "@/lib/apertureview";
import { getApertureGlance } from "@/lib/connectors/aperture";
import { r2Enabled } from "@/lib/r2";

export const metadata = { title: "aperture" };

// The inward look — owner-only, and everything under the header decrypts in the
// browser.
export const dynamic = "force-dynamic";

export default async function AperturePage() {
  // Owner-only: guests get a 404 (ADR 0022). The rank in the header is plaintext
  // at rest but renders only past this gate, and everything below it lives inside
  // the E2EE aperture and fin envelopes — the server renders the shell alone.
  const session = await auth();
  if (!session?.user) notFound();

  const who = session.user.name ?? "anthony";
  const glance = await getApertureGlance();
  const essence = glance ? essenceOf(glance.rank, glance.stage) : null;
  const membrane = glance ? membraneOf(glance.stage) : null;

  return (
    // The cultivation skin (ADR 0118) rides the container, unconditionally here
    // where the command center makes it conditional: this page IS the inward
    // look, and off the canon `essenceVarClass` already resolves to muted — so an
    // unplaced sheet degrades to neutral chrome rather than losing the stamps and
    // washes the page is drawn in.
    <main
      data-skin="cultivation"
      className={`mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6 ${essenceVarClass(
        essence,
      )}`}
    >
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={who} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">
            aperture
          </span>
          <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-amber">
            private
          </span>
        </div>

        {/* the essence sea — the one band that needs no key: rank, stage and the
            colour they name, off the plaintext glance. */}
        {glance ? (
          <div className="flex items-start justify-between gap-3 border-l-2 border-l-(--essence) bg-(--essence-faint) px-4 py-4">
            <div>
              <p
                className={`text-2xl leading-none ${essenceTextClass(essence)}`}
              >
                {essence ?? glance.stage}
              </p>
              <p className="mt-1.5 text-xs text-muted">
                rank {glance.rank} · {glance.stage}
                {membrane && ` — ${membrane}`}
              </p>
            </div>
            <span
              aria-hidden
              lang="zh"
              className="font-[family-name:var(--font-zh)] text-[34px] leading-none text-(--essence) opacity-80"
            >
              竅
            </span>
          </div>
        ) : (
          // Nothing sealed, or a read that failed — the masthead's own wording,
          // because it is the same fact stated on a different page.
          <div className="px-4 py-4">
            <p className="text-xs text-muted">unplaced — run aperture-sync</p>
          </div>
        )}

        <ApertureInner offline={!r2Enabled()} />
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
