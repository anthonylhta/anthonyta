"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { aud } from "@/lib/money";
import {
  RANGES,
  chartDay,
  chartGeometry,
  rangeSlice,
  type ChartMode,
  type RangeKey,
  type SplitPoint,
} from "@/lib/networth";
import { scrubIndex } from "@/lib/spark";
import type { Portfolio } from "@/lib/portfolio";

const MODE_KEY = "portfolio.chartMode";

/** The line/split choice as this device last left it (the FilesInbox strip-toggle
 *  pattern: read once on mount, `line` on the server so hydration matches). */
function useStoredMode(): ChartMode {
  const read = useRef<ChartMode | null>(null);
  const subscribe = useCallback((onStoreChange: () => void) => {
    try {
      read.current =
        window.localStorage.getItem(MODE_KEY) === "split" ? "split" : "line";
    } catch {
      read.current = "line";
    }
    onStoreChange();
    return () => {};
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => read.current ?? "line",
    () => "line",
  );
}

/** The plot box's pixel size — the SVG draws in real pixels so the axis text
 *  never stretches. Zero until mounted. */
function useBoxSize(): [
  React.RefObject<HTMLDivElement | null>,
  number,
  number,
] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({
        w: Math.round(e.contentRect.width),
        h: Math.round(e.contentRect.height),
      }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size.w, size.h];
}

const sign = (n: number) => (n >= 0 ? "+" : "−");
const toneOf = (n: number) =>
  n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted";

/**
 * Net worth as a trading app draws it: the figure, its change over the chosen
 * range, a tall chart with a real y-axis, range tabs, and a `line · split`
 * toggle — line is the total coloured by the range's direction, split stacks
 * investments under savings (HISA + cash). Drag or hover and the figure follows
 * the day under the cursor; it parks where a finger lifts, and a tap on the date
 * sends it home. Under it: each layer's figure and move, then the investments'
 * put in · worth · P&L from the last import.
 */
export function NetWorthChart({
  series,
  portfolio,
  debtLabel,
}: {
  series: SplitPoint[];
  portfolio: Portfolio | null;
  /** What to call the debts line: the one debt's name, or "debts" for several. */
  debtLabel: string;
}) {
  const stored = useStoredMode();
  const [picked, setPicked] = useState<ChartMode | null>(null);
  const mode = picked ?? stored;
  const [range, setRange] = useState<RangeKey>("ALL");
  const [at, setAt] = useState<number | null>(null);
  const [box, w, h] = useBoxSize();

  const pts = rangeSlice(series, range);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const cur = at !== null && pts[at] ? pts[at] : last;
  const scrubbing = cur !== last;
  // The headline is the NET — assets less debts. A % of a net start is only
  // meaningful with no debt in the range: a debt can leave the start near or
  // below zero, where any move reads as hundreds of percent.
  const owes = pts.some((p) => p.debtCents > 0);
  const delta = cur.netCents - first.netCents;
  const pct =
    !owes && first.netCents > 0 ? (delta / first.netCents) * 100 : null;
  const word = RANGES.find((r) => r.key === range)?.word ?? "";

  // The y labels sit in a gutter on the right, so they never ride the line.
  const gutter = 40;
  const g = w > 0 && h > 0 ? chartGeometry(pts, mode, w, h, gutter) : null;
  const dot = g?.points[at ?? pts.length - 1];

  function pickMode(m: ChartMode) {
    setPicked(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      // A blocked store just means the choice lasts as long as the page.
    }
  }
  function pickRange(k: RangeKey) {
    setRange(k);
    setAt(null);
  }
  function scrubTo(clientX: number) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const i = scrubIndex(clientX - rect.left, rect.width - gutter, pts.length);
    setAt(i === pts.length - 1 ? null : i);
  }

  const tabs = (
    <div className="flex gap-1">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => pickRange(r.key)}
          className={`flex-1 rounded-[3px] border px-2.5 py-1.5 text-xs transition-colors sm:flex-none sm:py-1 ${
            r.key === range
              ? "border-hairline bg-surface text-fg"
              : "border-transparent text-muted hover:text-fg"
          }`}
        >
          {r.key}
        </button>
      ))}
    </div>
  );

  const modes = (
    <div className="flex gap-0.5 text-[11px]">
      {(["line", "split"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => pickMode(m)}
          className={`rounded-[3px] border px-2 py-0.5 transition-colors ${
            m === mode
              ? "border-hairline bg-surface text-fg"
              : "border-transparent text-muted hover:text-fg"
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );

  const layer = (
    name: string,
    swatch: string,
    now: number,
    then: number,
    sub?: string,
  ) => {
    const d = now - then;
    return (
      <div className="flex items-baseline justify-between gap-3 px-4 py-2 sm:block sm:py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          {mode === "split" && (
            <span className={`inline-block h-2 w-2 rounded-[2px] ${swatch}`} />
          )}
          {name}
        </div>
        <div className="text-right sm:text-left">
          <div className="text-sm tabular-nums text-fg/90">
            {aud(now / 100)}
            <span className={`ml-2 text-[11px] sm:hidden ${toneOf(d)}`}>
              {sign(d)}
              {aud(Math.abs(d) / 100)}
            </span>
          </div>
          {sub && (
            <div className="text-[10px] tabular-nums text-muted">{sub}</div>
          )}
          <div
            className={`hidden text-[11px] tabular-nums sm:block ${toneOf(d)}`}
          >
            {sign(d)}
            {aud(Math.abs(d) / 100)} {word}
          </div>
        </div>
      </div>
    );
  };

  const t = portfolio?.totals ?? null;

  return (
    <>
      <div className="border-b border-hairline px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] uppercase tracking-[0.2em] text-muted">
              net worth
            </p>
            <p className="text-3xl tabular-nums text-fg sm:text-4xl">
              {aud(cur.netCents / 100)}
            </p>
            <p className="mt-1 text-[13px] tabular-nums">
              <span className={toneOf(delta)}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "·"} {sign(delta)}
                {aud(Math.abs(delta) / 100)}
                {pct !== null && ` (${sign(pct)}${Math.abs(pct).toFixed(1)}%)`}
              </span>{" "}
              {scrubbing ? (
                <button
                  type="button"
                  onClick={() => setAt(null)}
                  className="text-muted transition-colors hover:text-amber"
                  aria-label="back to today"
                >
                  {chartDay(first.date)} → {chartDay(cur.date)}
                </button>
              ) : (
                <span className="text-muted">{word}</span>
              )}
            </p>
            {owes && (
              <p className="mt-0.5 text-xs tabular-nums">
                <span className="text-muted">assets</span>{" "}
                {aud(cur.totalCents / 100)}{" "}
                <span className="whitespace-nowrap text-muted">
                  · {debtLabel} −{aud(cur.debtCents / 100)}
                </span>
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {modes}
            <div className="hidden sm:block">{tabs}</div>
          </div>
        </div>

        {/* pan-y keeps the page scrollable through the plot; only horizontal
            movement is ours. Pointer events cover mouse and touch alike. */}
        <div
          ref={box}
          className={`relative mt-3 h-[200px] cursor-crosshair touch-pan-y select-none sm:h-[260px] ${toneOf(
            pts.at(-1)!.netCents - first.netCents,
          )}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrubTo(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.pointerType === "mouse" || e.buttons > 0) scrubTo(e.clientX);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse" && e.buttons === 0) setAt(null);
          }}
        >
          {g && dot && (
            <svg
              width={w}
              height={h}
              viewBox={`0 0 ${w} ${h}`}
              className="block overflow-visible"
              role="img"
              aria-label={`net worth, ${word}`}
            >
              <defs>
                <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0"
                    stopColor="currentColor"
                    stopOpacity={0.22}
                  />
                  <stop offset="1" stopColor="currentColor" stopOpacity={0} />
                </linearGradient>
              </defs>
              {g.ticks.map((tk) => (
                <g key={tk.y}>
                  <line
                    x1={0}
                    x2={w - gutter}
                    y1={tk.y}
                    y2={tk.y}
                    className="stroke-hairline"
                  />
                  <text
                    x={w - gutter + 6}
                    y={tk.y + 3}
                    className="fill-muted text-[10px]"
                  >
                    {tk.label}
                  </text>
                </g>
              ))}
              {[0, Math.floor((pts.length - 1) / 2), pts.length - 1].map(
                (i, k) => (
                  <text
                    key={k}
                    x={g.points[i].x}
                    y={h - 4}
                    textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
                    className="fill-muted/70 text-[10px]"
                  >
                    {chartDay(pts[i].date)}
                  </text>
                ),
              )}
              {mode === "line" ? (
                <>
                  <line
                    x1={0}
                    x2={w - gutter}
                    y1={g.baseY}
                    y2={g.baseY}
                    className="stroke-muted/50"
                    strokeDasharray="2 4"
                  />
                  <path d={g.area} fill="url(#nw-fill)" />
                  <path
                    d={g.line}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                </>
              ) : (
                <>
                  <path
                    d={g.invested}
                    className="fill-invested/30 stroke-invested"
                    strokeWidth={1.25}
                  />
                  <path
                    d={g.savings}
                    className="fill-savings/30 stroke-savings"
                    strokeWidth={1.25}
                  />
                  <path
                    d={g.assets}
                    fill="none"
                    className="stroke-fg"
                    strokeWidth={1.75}
                  />
                  {/* after debts: the net, dashed under the assets' line */}
                  {owes && (
                    <path
                      d={g.line}
                      fill="none"
                      className="stroke-fg/80"
                      strokeWidth={1.25}
                      strokeDasharray="4 3"
                    />
                  )}
                </>
              )}
              {scrubbing && (
                <line
                  x1={dot.x}
                  x2={dot.x}
                  y1={0}
                  y2={g.floor}
                  className="stroke-muted/60"
                />
              )}
              <circle
                cx={dot.x}
                cy={dot.y}
                r={4}
                className={`stroke-bg ${mode === "line" ? "fill-current" : "fill-fg"}`}
                strokeWidth={2}
              />
            </svg>
          )}
        </div>

        <div className="mt-2.5 sm:hidden">{tabs}</div>
      </div>

      <div
        className={`grid border-b border-hairline sm:divide-x sm:divide-hairline ${
          owes ? "sm:grid-cols-3" : "sm:grid-cols-2"
        }`}
      >
        {layer(
          "investments",
          "bg-invested",
          cur.investedCents,
          first.investedCents,
        )}
        {layer(
          "savings",
          "bg-savings",
          cur.savingsCents,
          first.savingsCents,
          `HISA ${aud(cur.hisaCents / 100)} · cash ${aud(cur.cashCents / 100)}`,
        )}
        {/* negated, so a debt going down reads as a green move */}
        {owes && layer(debtLabel, "bg-muted", -cur.debtCents, -first.debtCents)}
      </div>

      {t && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-hairline px-4 py-3 text-xs tabular-nums">
          <span>
            <span className="text-muted">put in</span> {aud(t.cost)}
          </span>
          <span>
            <span className="text-muted">worth</span> {aud(t.value)}
          </span>
          <span>
            <span className="text-muted">P&amp;L</span>{" "}
            <span className={toneOf(t.pnl)}>
              {sign(t.pnl)}
              {aud(Math.abs(t.pnl))} ({sign(t.pnlPct)}
              {Math.abs(t.pnlPct).toFixed(1)}%)
            </span>
          </span>
        </div>
      )}
    </>
  );
}
