/**
 * One band divider of the character sheet — the header the page is read down by.
 * The left label names the band, the right side carries its one-line summary (the
 * wall being worked, the count of what is failing, the next trial's countdown).
 *
 * Two registers, one component: a header given a `seal` glyph is an aperture
 * band's and wears the sheet's essence (the cultivation skin, ADR 0118) with the
 * glyph in place of the amber tick; without one it is mortal chrome and keeps
 * the house amber — the mortal zone stays mortal by never passing a seal.
 *
 * Deliberately free of any import: the command center renders it on the server and
 * the sealed island renders it in the browser, so it has to be safe in both.
 */
export function ZoneHeader({
  label,
  right,
  seal,
}: {
  label: string;
  right?: string;
  /** The band's CJK seal glyph — presence selects the essence register. */
  seal?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-hairline px-4 py-1.5 ${
        seal ? "bg-(--essence-faint)" : "bg-amber/[0.04]"
      }`}
    >
      {seal ? (
        <span className="text-[10px] uppercase tracking-[0.22em] text-(--essence)">
          <span
            aria-hidden
            lang="zh"
            className="mr-1.5 font-[family-name:var(--font-zh)] text-(--essence-soft)"
          >
            {seal}
          </span>
          {label}
        </span>
      ) : (
        <span className="text-[10px] uppercase tracking-[0.22em] text-amber/85">
          ▍ {label}
        </span>
      )}
      {right && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted">
          {right}
        </span>
      )}
    </div>
  );
}
