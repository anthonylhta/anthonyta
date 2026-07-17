import type { ChoreState } from "@/lib/chores";

/** One chore chip — `vault-sync 1d ✓` muted, amber at due, red at overdue,
 *  and an honest "no record" when there's no evidence yet. */
export function ChoreChip({
  label,
  state,
}: {
  label: string;
  state: ChoreState;
}) {
  if (state.status === "unknown")
    return <span className="text-xs text-muted/50">{label} — no record</span>;
  const age = `${state.ageDays}d`;
  if (state.status === "ok")
    return (
      <span className="text-xs text-muted">
        {label} {age} <span className="text-up">✓</span>
      </span>
    );
  return (
    <span
      className={`text-xs ${state.status === "due" ? "text-amber" : "text-down"}`}
    >
      {label} {age} {state.status}
    </span>
  );
}
