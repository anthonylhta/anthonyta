import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { GuInner } from "@/components/GuInner";
import { StatusBar } from "@/components/terminal/StatusBar";
import { essenceOf } from "@/lib/aperture";
import { essenceVarClass } from "@/lib/apertureview";
import { getApertureGlance } from "@/lib/connectors/aperture";
import { getGithub } from "@/lib/connectors/github";
import { getSteps } from "@/lib/connectors/steps";
import { sydneyToday } from "@/lib/fin";
import { r2Enabled } from "@/lib/r2";
import { lastStepsDay } from "@/lib/steps";

export const metadata = { title: "gu" };

// The compendium is the inward page's second half — owner-only, and everything
// under the header decrypts in the browser.
export const dynamic = "force-dynamic";

export default async function GuPage() {
  // Owner-only: guests get a 404 (ADR 0022), exactly as /aperture does. Nothing
  // gu-shaped may be reachable outside the owner session, and the server renders
  // the shell alone — every gu on this page comes out of the sealed envelope.
  const session = await auth();
  if (!session?.user) notFound();

  const who = session.user.name ?? "anthony";
  const today = sydneyToday();
  // The glance carries the skin's essence (plaintext at rest, rendered past the
  // gate); the github and steps reads carry the feeding evidence — a gu that
  // names a repo is fed by that repo's pushes, one that names the steps log by
  // the phone's newest push, rather than by a day typed at the check-in. The
  // sealed logs (gym, meals) are read in the browser, where the key is.
  const [glance, gh, steps] = await Promise.all([
    getApertureGlance(),
    getGithub(),
    getSteps(today),
  ]);
  const essence = glance ? essenceOf(glance.rank, glance.stage) : null;
  const stepsDay = lastStepsDay(steps);

  return (
    <main
      data-skin="cultivation"
      className={`skin-wash mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6 ${essenceVarClass(
        essence,
      )}`}
    >
      <div className="border border-hairline bg-surface/20">
        <StatusBar user={who} />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          {/* back to the reading this page was cut out of, not to the hub */}
          <Link href="/aperture" className="text-muted hover:text-amber">
            ← aperture
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">gu</span>
          <span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] text-amber">
            private
          </span>
        </div>

        <GuInner
          offline={!r2Enabled()}
          repoPushes={gh.pushes}
          logDays={stepsDay !== null ? { steps: stepsDay } : {}}
          today={today}
        />
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">private · {who}</p>
    </main>
  );
}
