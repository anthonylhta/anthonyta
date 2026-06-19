import type { ReactNode } from "react";

/** A bordered "module" card — the repeating unit of the dashboard grid. */
export function Module({
  label,
  action,
  children,
  className = "",
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col border border-hairline bg-surface/40 ${className}`}
    >
      <header className="flex items-center justify-between border-b border-hairline px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-[0.2em] text-muted">
          {label}
        </span>
        {action}
      </header>
      <div className="flex-1 px-3 py-3 text-sm">{children}</div>
    </section>
  );
}
