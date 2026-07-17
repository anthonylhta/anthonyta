/**
 * The connector pattern (notes/decisions/0003).
 *
 * A connector reads ONE external data source — one of Anthony's projects — and
 * returns a normalized shape the hub renders. The hub never writes to a project
 * DB; connectors are server-side and read-only. Adding a new project to the hub
 * is "write a new connector", not "rebuild the site".
 *
 *   webnovel   → Supabase (webnovelist)      reading shelf, stats
 *   translator → Supabase (ishin)            vocab / language stats
 *   riichi     → Neon (riichi)               hand of the day, streaks
 *   finance    → hub DB / risk_first_paper_bot  daily briefing, portfolio
 *
 * Until each source is wired, the homepage renders `src/lib/mock.ts`; swapping a
 * mock field for `await connector.fetch()` is the whole migration per feature.
 */
export interface Connector<T> {
  /** stable id, e.g. "webnovel" | "riichi" | "translator" | "finance" */
  key: string;
  /** human label for the module header */
  label: string;
  /** server-side, read-only read of the source's current state */
  fetch(): Promise<T>;
}
