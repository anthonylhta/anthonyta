"use client";

import { ChoreChip } from "@/components/ChoreChip";
import { useCsvChore } from "@/components/useCsvChore";
import type { ChoreState } from "@/lib/chores";

/**
 * ChoresRow — maintenance freshness as an EXCEPTION-only row: while every chore
 * is fresh the row isn't there at all, and when it is, it names only the chores
 * that have gone due or overdue. A chore with no record (or a locked vault, for
 * the csv one) counts as quiet — the row nags about evidence of neglect, never
 * about the absence of evidence.
 *
 * A client island because the csv chore has to be: its evidence lives inside the
 * decrypted fin envelope. The two server-read states ride in as props.
 */
export function ChoresRow({
  offline,
  vaultSync,
  backup,
}: {
  offline: boolean;
  vaultSync: ChoreState;
  backup: ChoreState;
}) {
  const csv = useCsvChore(offline);
  const due = [
    { label: "csv import", state: csv },
    { label: "vault-sync", state: vaultSync },
    { label: "backup", state: backup },
  ].filter((c) => c.state.status === "due" || c.state.status === "overdue");

  if (due.length === 0) return null;

  return (
    <div className="flex items-baseline gap-3 border-t border-hairline px-4 py-2.5 text-sm">
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
        chores
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
        {due.map((c) => (
          <ChoreChip key={c.label} label={c.label} state={c.state} />
        ))}
      </span>
    </div>
  );
}
