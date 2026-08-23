import Link from "next/link";
import { StatusBar } from "@/components/terminal/StatusBar";
import { IDENTITY, SECTIONS, SKILLS } from "@/lib/resume";
import { PrintButton } from "./PrintButton";

export const metadata = { title: "resume" };

// Public resume page (roadmap 82a) — content versioned in lib/resume, rendered
// in Warm Terminal on screen and as a clean light sheet in print (the token
// override in globals.css keyed on data-page="resume"; browsers already skip
// painting dark backgrounds, the override re-inks the text). window.print() IS
// the PDF story: one source of truth, no binary accreting in the public repo.
// Static content, no session read, no connector.
export default function ResumePage() {
  return (
    <main
      data-page="resume"
      className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6 print:py-0"
    >
      <div className="border border-hairline bg-surface/20 print:border-0">
        <div className="print:hidden">
          <StatusBar user="anthony ta" />
        </div>

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs print:hidden">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">resume</span>
          <PrintButton />
        </div>

        {/* identity */}
        <div className="border-b border-hairline px-4 py-4">
          <h1 className="text-[22px] font-semibold tracking-[0.02em]">
            {IDENTITY.name}
          </h1>
          {/* Each token is its own nowrap chunk so the line wraps BETWEEN
              items — adjacent JSX drops the whitespace between spans, which
              left this a single unbreakable run pushing off a phone screen. */}
          <p className="mt-1.5 flex flex-wrap items-baseline gap-y-0.5 text-xs leading-relaxed text-muted">
            <span className="whitespace-nowrap">{IDENTITY.location}</span>
            <span className="whitespace-nowrap">
              <span className="px-1.5 text-muted/45">·</span>
              {IDENTITY.email}
            </span>
            {IDENTITY.links.map((l) => (
              <span key={l.href} className="whitespace-nowrap">
                <span className="px-1.5 text-muted/45">·</span>
                <a
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber hover:underline"
                >
                  {l.label}
                </a>
              </span>
            ))}
          </p>
        </div>

        {SECTIONS.map((section) => (
          <div
            key={section.label}
            className="border-b border-hairline px-4 py-4"
          >
            <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">
              {section.label}
            </p>
            {section.entries.map((e) => (
              <div key={e.title} className="mb-3.5 last:mb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-[13px] font-semibold">{e.title}</span>
                  {e.when && (
                    <span className="text-[11px] tabular-nums text-muted">
                      {e.when}
                    </span>
                  )}
                </div>
                {(e.sub || e.where || e.stack || e.links) && (
                  <div className="mt-px flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] text-muted">
                    <span>
                      {e.sub}
                      {e.stack && (
                        <span className="text-[10px] tracking-[0.03em]">
                          {e.stack}
                        </span>
                      )}
                    </span>
                    <span>
                      {e.where}
                      {e.links?.map((l, i) => (
                        <span key={l.href}>
                          {i > 0 && <span className="px-1">·</span>}
                          {l.href.startsWith("/") ? (
                            <Link
                              href={l.href}
                              className="text-amber hover:underline"
                            >
                              {l.label}
                            </Link>
                          ) : (
                            <a
                              href={l.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-amber hover:underline"
                            >
                              {l.label}
                            </a>
                          )}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
                {e.bullets && (
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {e.bullets.map((b) => (
                      <li
                        key={b.text}
                        className="relative pl-3.5 text-xs leading-relaxed text-muted"
                      >
                        <span className="absolute left-0 text-amber">·</span>
                        {b.lead && (
                          <>
                            <span className="font-medium text-fg">
                              {b.lead}
                            </span>{" "}
                            —{" "}
                          </>
                        )}
                        {b.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ))}

        {/* skills */}
        <div className="px-4 py-4">
          <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">
            skills
          </p>
          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-xs">
            {SKILLS.map((s) => (
              <div key={s.group} className="contents">
                <dt className="text-muted">{s.group}</dt>
                <dd className="leading-relaxed text-fg">{s.items}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60 print:hidden">
        anthony ta · sydney
      </p>
    </main>
  );
}
