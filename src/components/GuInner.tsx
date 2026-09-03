"use client";

import { useMemo, type ReactNode } from "react";
import { ZoneHeader } from "@/components/terminal/ZoneHeader";
import type { ApertureCast, ApertureRefinement } from "@/lib/aperture";
import {
  castsThisMonth,
  detailStatus,
  experienceBudget,
  feedingLabel,
  guBlocks,
  guCensus,
  guReads,
  type GuBlock,
  type GuRead,
} from "@/lib/apertureview";
import { recoveredThisWeek } from "@/lib/fin";
import { aud } from "@/lib/money";
import { useApertureDoc } from "./useApertureDoc";

/**
 * GuInner — the compendium, as ONE client island. The inward page grew past what
 * one reading can hold, so everything ABOUT gu moved here: what is held and by
 * which path, what is held by no path at all, what has been burned this month,
 * and what is being refined toward. /aperture keeps a single line pointing at it.
 *
 * Same seal, same key, same walk: the document is opened by `useApertureDoc`, the
 * hook the inward page reads through, so this page can never disagree with that
 * one about what was sealed. The fin envelope rides along for one figure — the
 * week's recovered income, which the burn allotment is a share of.
 *
 * IT ADJUDICATES NOTHING and it NEVER NAGS. A feeding state is a reading, printed
 * muted like every other fact here; a rock is dimmed rather than flagged; the
 * header counts inventory and never hunger. No amber appears on this page at all —
 * amber is the hub's word for "something wants you", and a gu that wants feeding
 * is information, not an alarm.
 */
export function GuInner({
  offline,
  repoPushes,
  today,
}: {
  offline: boolean;
  /** Every public repo's last push, keyed by name (the github connector). A gu
   *  that names a repo is fed by its pushes; an unlisted repo falls back to the
   *  day the check-in sealed. */
  repoPushes: Record<string, string>;
  /** The Sydney calendar day, anchored once on the server so every clock on this
   *  page counts from the same midnight. */
  today: string;
}) {
  const { status, doc, fin, dataErr } = useApertureDoc(offline);

  const blocks = useMemo(
    () => (doc ? guBlocks(doc.sealed.paths, today, repoPushes) : []),
    [doc, today, repoPushes],
  );
  const held = useMemo(
    () => (doc ? guReads(doc.sealed.held, today, repoPushes) : []),
    [doc, today, repoPushes],
  );
  const census = useMemo(() => guCensus(blocks, held), [blocks, held]);
  const month = useMemo(
    () => castsThisMonth(doc?.sealed.consumables?.casts ?? [], today),
    [doc, today],
  );

  switch (detailStatus(status, dataErr, doc)) {
    case "offline":
      return <StatusLine>store offline — set the R2_* env vars</StatusLine>;

    case "sealed":
      // The compendium is entirely behind the key, so the seal IS the page —
      // the same stamp and the same line the inward page shows.
      return (
        <div className="flex flex-col items-center gap-3 px-4 py-12">
          <span
            aria-hidden
            lang="zh"
            className="skin-stamp h-16 w-16 -rotate-6 border-[3px] text-[38px] opacity-75"
          >
            封
          </span>
          <p className="text-xs text-muted">
            sealed — unlock on the sheet to look inward
          </p>
        </div>
      );

    case "decrypting":
      return <p className="px-4 py-6 text-xs text-muted">decrypting…</p>;

    case "unreachable":
      return <StatusLine>vault unreachable — reload to retry</StatusLine>;

    case "tamper":
      return <StatusLine>cannot decrypt — lock and unlock</StatusLine>;
  }

  // `ready` — narrowed by the switch above, but TS can't see it through the helper.
  if (!doc) return null;
  const { rented, consumables, refining } = doc.sealed;
  const budget = consumables
    ? experienceBudget(
        fin ? recoveredThisWeek(fin, today) : null,
        consumables.budgetPct,
      )
    : null;

  return (
    <>
      <ZoneHeader label="gu" seal="蛊" right={censusLine(census)} />

      <Section label="gu held">
        {blocks.length === 0 ? (
          <p className="text-xs text-muted">nothing inventoried yet</p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {blocks.map((b) => (
              <GuBlockRows key={b.name} block={b} />
            ))}
          </div>
        )}
        {rented && rented.length > 0 && (
          <p className="mt-3 text-[11px] text-muted">
            rented · {rented.join(" · ")}
          </p>
        )}
      </Section>

      {held.length > 0 && (
        <Section label="held, no path">
          <GuRows reads={held} />
          <Flavor>held by the house rather than by a road.</Flavor>
        </Section>
      )}

      {consumables && (
        <Section label="consumables">
          {/* The allotment reads off `recoveredThisWeek`, which is a TRAILING
              seven days rather than a calendar week (lib/fin), so the line says
              "with the week" instead of naming a weekday: there is no Monday
              boundary in the arithmetic to promise one, and income lands
              mid-week anyway. Muted throughout — a budget is a reading here,
              never a warning, so no colour and no bar. */}
          <p className="text-[11px] tabular-nums text-muted">
            experience budget · {consumables.budgetPct}% of recovered ·{" "}
            <span className="text-fg/80">
              {budget === null ? "—" : aud(budget / 100)}
            </span>{" "}
            this wk · spent{" "}
            <span className="text-fg/80">{aud(month.stones / 100)}</span> this
            month · regenerates with the week
          </p>
          {month.casts.length === 0 ? (
            <p className="mt-2.5 text-xs text-muted">none cast this month</p>
          ) : (
            <div className="mt-2.5 flex flex-col gap-1">
              {month.casts.map((c, i) => (
                <CastRow key={`${c.date}-${i}`} cast={c} />
              ))}
            </div>
          )}
        </Section>
      )}

      {refining && refining.length > 0 && (
        <Section label="refining">
          <div className="flex flex-col gap-2.5">
            {refining.map((r, i) => (
              <RefiningRow key={`${r.name}-${i}`} entry={r} />
            ))}
          </div>
          <Flavor>
            the recipe book&apos;s open page — nothing here is held.
          </Flavor>
        </Section>
      )}
    </>
  );
}

/** The header's right side: inventory, and rocks when there are any. Never a
 *  count of hungry gu — that number at the top of a page is a nag by another name. */
function censusLine(census: { total: number; rocks: number }): string {
  const held = `${census.total} held`;
  if (census.rocks === 0) return held;
  return `${held} · ${census.rocks} rock${census.rocks === 1 ? "" : "s"}`;
}

/** One bordered band, labelled in the register the inward page reads in. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-hairline px-4 py-4">
      <p className="mb-2.5 text-[11px] uppercase tracking-[0.2em] text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

/** The line under a band that says what the band is FOR. */
function Flavor({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[11px] italic text-muted/60">{children}</p>;
}

function StatusLine({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-xs text-down">{children}</p>;
}

/** One path's (or sub-path's) gu, under its name and the rung it stands at. */
function GuBlockRows({ block }: { block: GuBlock }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.15em] text-muted/70">
        {block.name}
        {block.attainment && (
          <span className="ml-2 tracking-normal text-muted/60 normal-case">
            {block.attainment}
          </span>
        )}
      </p>
      <GuRows reads={block.gu} />
    </div>
  );
}

function GuRows({ reads }: { reads: GuRead[] }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {reads.map((r, i) => (
        <GuRow key={`${r.gu.name}-${i}`} read={r} />
      ))}
    </div>
  );
}

/**
 * One gu: the inward page's list idiom (the bearer inked, the rest quiet) with
 * its clock appended muted. A rock dims WHOLE — it is dormant, not wrong — and a
 * gu with no clock says nothing at all, because a foundation gu was fed once and
 * holds.
 */
function GuRow({ read }: { read: GuRead }) {
  const { gu, feeding } = read;
  const rock = feeding?.state === "hibernating";
  return (
    <p className={`text-xs ${rock ? "opacity-40" : ""}`}>
      <span
        aria-hidden
        className={gu.bears ? "text-(--essence)" : "text-muted/40"}
      >
        ●{" "}
      </span>
      <span className="text-fg/90">{gu.name}</span>
      {gu.type && <span className="text-muted"> — {gu.type}</span>}
      {feeding && (
        <span className="text-muted"> · {feedingLabel(feeding)}</span>
      )}
    </p>
  );
}

/** One cast: when, what, of what kind, and what it cost. */
function CastRow({ cast }: { cast: ApertureCast }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums">
      <span className="text-muted">{cast.date}</span>
      <span className="text-fg/90">{cast.name}</span>
      {cast.type && <span className="text-muted/70">{cast.type}</span>}
      {cast.stones !== undefined && (
        <span className="ml-auto text-muted">{aud(cast.stones / 100)}</span>
      )}
    </p>
  );
}

/** One entry in the queue — what it would be, what would prove it, what it wants. */
function RefiningRow({ entry }: { entry: ApertureRefinement }) {
  return (
    <div>
      <p className="text-xs">
        <span className="text-fg/80">{entry.name}</span>
        <span className="text-muted">
          {" "}
          — rank {entry.rank} · {entry.type}
        </span>
      </p>
      <p className="mt-0.5 text-[11px] text-muted">{entry.test}</p>
      {entry.needs && (
        <p className="mt-0.5 text-[11px] text-muted/70">
          needs · {entry.needs}
        </p>
      )}
    </div>
  );
}
