import Link from "next/link";
import { SessionStatusBar } from "@/components/SessionStatusBar";

// Static page — no data, no auth. Public "how to reach me" links.
const channels = [
  {
    label: "email",
    value: "anthony.ta@live.com",
    href: "mailto:anthony.ta@live.com",
  },
  {
    label: "github",
    value: "@anthonylhta",
    href: "https://github.com/anthonylhta",
  },
  {
    label: "linkedin",
    value: "anthony ta",
    href: "https://www.linkedin.com/in/anthonylhta/",
  },
];

export default function ContactPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6">
      <div className="border border-hairline bg-surface/20">
        <SessionStatusBar />

        <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
          <Link href="/" className="text-muted hover:text-amber">
            ← hub
          </Link>
          <span className="uppercase tracking-[0.2em] text-muted">contact</span>
          <span aria-hidden />
        </div>

        {/* hero */}
        <div className="border-b border-hairline px-4 py-8">
          <p className="text-sm text-muted">
            <span className="text-amber">&gt;</span>{" "}
            <span className="cursor text-fg">get in touch</span>
          </p>
          <p className="mt-3 text-sm text-fg/80">
            The quickest ways to reach me.
          </p>
        </div>

        {/* channels */}
        <div className="divide-y divide-hairline">
          {channels.map((c) => {
            const external = c.href.startsWith("http");
            return (
              <a
                key={c.label}
                href={c.href}
                target={external ? "_blank" : undefined}
                rel={external ? "noopener noreferrer" : undefined}
                className="flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-surface/30"
              >
                <span className="flex items-baseline gap-4">
                  <span className="w-16 shrink-0 text-[11px] uppercase tracking-[0.15em] text-muted">
                    {c.label}
                  </span>
                  <span className="text-fg">{c.value}</span>
                </span>
                <span className="text-amber">↗</span>
              </a>
            );
          })}
        </div>

        {/* location */}
        <div className="border-t border-hairline px-4 py-3 text-sm">
          <span className="flex items-baseline gap-4">
            <span className="w-16 shrink-0 text-[11px] uppercase tracking-[0.15em] text-muted">
              based in
            </span>
            <span className="text-fg/80">Sydney, Australia · AEST</span>
          </span>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}
