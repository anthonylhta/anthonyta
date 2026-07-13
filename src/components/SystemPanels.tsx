import { Sparkline } from "@/components/terminal/Sparkline";
import {
  b64ToBytes,
  hllEstimate,
  topPaths,
  type DayStats,
} from "@/lib/analytics";
import { mergeDays } from "@/lib/anastore";
import { summarizeCsp } from "@/lib/cspreport";
import { readCspDays } from "@/lib/cspstore";
import { isWebauthnRecord, type WebauthnCred } from "@/lib/webauthn/record";
import { getWebauthnRecord } from "@/lib/webauthn/store";

/**
 * The owner-only /system panels — the command center's look-at-occasionally plumbing
 * (traffic, csp) plus the access section's last-sign-in line, lifted out of the daily
 * driver. Every panel is a server component rendered behind the /system page's auth
 * gate, so none of this reaches a guest.
 */

/** An ISO instant as a Sydney "13 Jul, 14:32" — the "last sign-in" timestamp. */
function sydneyDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * The most recent successful sign-in across every enrolled passkey — the record's
 * max `lastUsedAt` and the credential that carried it (roadmap item 37c). Read
 * server-side, best-effort: a store miss or an unstamped record → null, and the
 * line is omitted. Surfacing it makes unauthorized door use visible. ISO stamps
 * are Z-suffixed (`toISOString`), so a lexicographic max is the chronological max.
 */
async function lastSignIn(): Promise<{ at: string; label: string } | null> {
  const read = await getWebauthnRecord();
  if (read.state !== "ok") return null;
  let record: unknown;
  try {
    record = JSON.parse(read.value);
  } catch {
    return null;
  }
  if (!isWebauthnRecord(record)) return null;
  let best: WebauthnCred | null = null;
  for (const c of record.creds) {
    if (c.lastUsedAt && (!best?.lastUsedAt || c.lastUsedAt > best.lastUsedAt))
      best = c;
  }
  return best?.lastUsedAt ? { at: best.lastUsedAt, label: best.label } : null;
}

/**
 * The "last sign-in" line — a stamp on every passkey sign-in (roadmap item 37c);
 * renders nothing until the first stamp exists.
 */
export async function LastSignIn() {
  const signIn = await lastSignIn();
  if (!signIn) return null;
  return (
    <div className="border-b border-hairline px-4 py-2 text-xs text-muted">
      last sign-in: {sydneyDateTime(signIn.at)} · {signIn.label}
    </div>
  );
}

/** Unique-visitor estimate for one (possibly empty) record. Empty sketch → 0. */
function uniquesOf(day: DayStats): number {
  return day.visitors_hll_b64
    ? hllEstimate(b64ToBytes(day.visitors_hll_b64))
    : 0;
}

/** Total pageviews across a record's paths. */
function viewsOf(day: DayStats): number {
  return Object.values(day.paths).reduce((sum, s) => sum + s.views, 0);
}

/**
 * The private traffic panel — cookieless pageviews + HLL unique estimates for today
 * and the trailing week, the top paths, and a uniques sparkline. Owner-only (it lives
 * behind the /system auth gate) and read-only. Store off / no data → a quiet "no
 * traffic yet". This is the ONLY place the numbers surface.
 */
export function AnalyticsPanel({
  today,
  days,
}: {
  today: string;
  days: DayStats[];
}) {
  if (days.length === 0) {
    return <p className="text-muted">no traffic yet</p>;
  }

  const todayRec = days.find((d) => d.date === today);
  const todayViews = todayRec ? viewsOf(todayRec) : 0;
  const todayUniques = todayRec ? uniquesOf(todayRec) : 0;

  // Week totals ride the merged sketch — register-max unions the daily uniques so a
  // returning visitor isn't double-counted across days.
  const weekAgg = mergeDays(days);
  const weekViews = viewsOf(weekAgg);
  const weekUniques = uniquesOf(weekAgg);
  const top = topPaths(weekAgg).slice(0, 5);

  const spark = days.map(uniquesOf);
  const delta = spark.length >= 2 ? spark[spark.length - 1] - spark[0] : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-px bg-hairline">
        <Stat label="today" views={todayViews} uniques={todayUniques} />
        <Stat label="this week" views={weekViews} uniques={weekUniques} />
      </div>

      {spark.length >= 2 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted">
            daily uniques
          </div>
          <Sparkline values={spark} delta={delta} height={40} />
        </div>
      )}

      {top.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted">
            top paths
          </div>
          <ul className="space-y-0.5">
            {top.map((p) => (
              <li
                key={p.path}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="truncate font-[family-name:var(--font-geist-mono)] text-fg/90">
                  {p.path}
                </span>
                <span className="shrink-0 tabular-nums text-muted">
                  <span className="text-amber">{p.views}</span> · {p.uniques}{" "}
                  uniq
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The private CSP-violation panel — last 7 days of first-party violation reports
 * (roadmap 37e), grouped by directive → blocked origin. Self-contained: it reads its
 * own week from cspstore (owner-only, behind the /system auth gate). Store off / no
 * reports → the quiet "0 violations" line, which is itself the good news.
 */
export async function CspPanel({ today }: { today: string }) {
  const { total, groups } = summarizeCsp(await readCspDays(today, 7));

  if (total === 0) {
    return <p className="text-muted">csp: 0 violations this week</p>;
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">
        csp violations · <span className="text-amber">{total}</span>
      </div>
      <ul className="space-y-1.5">
        {groups.slice(0, 5).map((g) => (
          <li key={g.directive}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-[family-name:var(--font-geist-mono)] text-fg/90">
                {g.directive}
              </span>
              <span className="shrink-0 tabular-nums text-amber">
                {g.total}
              </span>
            </div>
            <ul className="mt-0.5 space-y-0.5 pl-3">
              {g.origins.slice(0, 3).map((o) => (
                <li
                  key={o.origin}
                  className="flex items-baseline justify-between gap-3 text-xs text-muted"
                >
                  <span className="truncate">{o.origin}</span>
                  <span className="shrink-0 tabular-nums">{o.count}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One traffic stat cell — views over unique estimate, mono + lowercase. */
function Stat({
  label,
  views,
  uniques,
}: {
  label: string;
  views: number;
  uniques: number;
}) {
  return (
    <div className="bg-surface/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">
        {label}
      </div>
      <div className="mt-0.5 tabular-nums">
        <span className="text-lg text-amber">{views}</span>{" "}
        <span className="text-xs text-muted">views</span>
      </div>
      <div className="text-xs tabular-nums text-muted">
        {uniques} unique{uniques === 1 ? "" : "s"}
      </div>
    </div>
  );
}
