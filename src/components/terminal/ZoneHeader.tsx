/**
 * One band divider of the character sheet — the header the page is read down by.
 * The left label names the band, the right side carries its one-line summary (the
 * wall being worked, the count of what is failing, the next trial's countdown).
 *
 * Deliberately free of any import: the command center renders it on the server and
 * the sealed island renders it in the browser, so it has to be safe in both.
 */
export function ZoneHeader({
  label,
  right,
}: {
  label: string;
  right?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline bg-amber/[0.04] px-4 py-1.5">
      <span className="text-[10px] uppercase tracking-[0.22em] text-amber/85">
        ▍ {label}
      </span>
      {right && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted">
          {right}
        </span>
      )}
    </div>
  );
}
