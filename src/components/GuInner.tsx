"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  checkSeqAndRemember,
  rememberSavedSeq,
  SeqAlarm,
} from "@/components/SeqAlarm";
import { ZoneHeader } from "@/components/terminal/ZoneHeader";
import { GU_MARKS_CONTEXT } from "@/lib/aevcontext";
import {
  almanacGroups,
  type AlmanacRead,
  BOOK_PAGE,
  bookCounts,
  bookEntries,
  type BookEntry,
  bookPage,
  bookPageCount,
  bookStatus,
  castsThisMonth,
  detailStatus,
  experienceBudget,
  feedingDot,
  feedingLabel,
  type GuBlock,
  guBlocks,
  guCensus,
  type GuRead,
  guReads,
  type LedgerEntry,
  ledgerEntries,
  ledgerPage,
} from "@/lib/apertureview";
import { recoveredThisWeek } from "@/lib/fin";
import {
  EMPTY_GU_MARKS,
  normalizeGuMarks,
  reconcileMarks,
  unsealedCasts,
  withCast,
  withSince,
  type GuCastMark,
  type GuMarksConfig,
} from "@/lib/gumarks";
import { aud } from "@/lib/money";
import { nextSeq } from "@/lib/seqrule";
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
 * THE PAGE'S RESTING HEIGHT IS SET BY ITS GROUPS, NEVER BY ITS MEMBERS. A path
 * folds to one row — its name, its rung, a dot per gu, a count — and the dot
 * strip IS the feeding ledger at a glance: filled is fed (or a foundation, which
 * holds), a ring is past its interval, a dim ring is a rock, essence marks the
 * gu that bears the path. Tap the row and the gu appear under it with their
 * clocks. The queue folds the same way, one row per entry with the test and what
 * it needs underneath; a month's casts fold under their meter. Growth goes into
 * the unfold, not onto the page, so the compendium at thirty gu is the height of
 * the compendium at fourteen. Fold state is component state: it dies with the
 * key, like every unfold on the sheet, and the page opens folded on both widths
 * — one behaviour, no memory.
 *
 * IT ADJUDICATES NOTHING and it NEVER NAGS. A feeding state is a reading, printed
 * muted like every other fact here; a rock is dimmed rather than flagged; a group
 * row counts inventory and never hunger, and so does the header. No amber appears
 * on this page at all — amber is the hub's word for "something wants you", and a
 * gu that wants feeding is information, not an alarm.
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
  const { status, doc, fin, dataErr, openItem, sealItem } =
    useApertureDoc(offline);

  // --- the book's marks: the owner's word, a rider under the same key ----------
  // Loaded once the document is open, retired by `reconcileMarks` as the seal
  // catches up, written back with the jobs ledger's seal → PUT → retry-once
  // dance (ADR 0175). The marks leave with the document.
  const [marks, setMarks] = useState<GuMarksConfig | null>(null);
  const [marksExisted, setMarksExisted] = useState(false);
  const [marksAlarm, setMarksAlarm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const hasDoc = doc !== null;
  const [hadDoc, setHadDoc] = useState(hasDoc);
  if (hadDoc !== hasDoc) {
    setHadDoc(hasDoc);
    if (!hasDoc) {
      setMarks(null);
      setMarksExisted(false);
      setNotice(null);
    }
  }

  const putMarks = useCallback(
    async (
      next: GuMarksConfig,
      prior: GuMarksConfig,
      existed: boolean,
    ): Promise<
      { state: "ok"; written: GuMarksConfig } | { state: "conflict" | "failed" }
    > => {
      // Bump the sealed write counter (58b); prior = the newer of what was
      // loaded and next itself (a 409-dance rebuild carries the fresher seq).
      const written = {
        ...next,
        seq: Math.max(nextSeq(prior), nextSeq(next)),
      };
      const bytes = new TextEncoder().encode(JSON.stringify(written));
      const sealed = await sealItem(
        { n: "gu-marks.json", t: "application/json", s: bytes.length },
        bytes,
        GU_MARKS_CONTEXT,
      );
      const res = await fetch("/api/gu-marks", {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          ...(existed ? { "x-gu-marks-overwrite": "1" } : {}),
        },
        body: new Blob([sealed as BlobPart]),
      });
      if (res.status === 409) return { state: "conflict" };
      if (!res.ok) return { state: "failed" };
      rememberSavedSeq("gu-marks", written);
      return { state: "ok", written };
    },
    [sealItem],
  );

  const fetchMarks = useCallback(async (): Promise<{
    cfg: GuMarksConfig;
    existed: boolean;
  }> => {
    const res = await fetch("/api/gu-marks");
    if (res.status === 404) return { cfg: EMPTY_GU_MARKS, existed: false };
    if (res.status !== 200) throw new Error(`gu-marks: ${res.status}`);
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      GU_MARKS_CONTEXT,
    );
    const cfg = normalizeGuMarks(JSON.parse(new TextDecoder().decode(bytes)));
    if (!cfg) throw new Error("gu-marks: bad shape");
    return { cfg, existed: true };
  }, [openItem]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      let loaded: { cfg: GuMarksConfig; existed: boolean };
      try {
        loaded = await fetchMarks();
      } catch {
        if (!cancelled) setNotice("marks unreachable — reload to retry");
        return;
      }
      if (cancelled) return;
      // Retire what the seal has caught up with. The write-back is best-effort:
      // the page already reads the settled record either way.
      const settled = reconcileMarks(loaded.cfg, doc.sealed.refining ?? []);
      setMarks(settled);
      setMarksExisted(loaded.existed);
      void checkSeqAndRemember("gu-marks", loaded.cfg).then((rolled) => {
        if (rolled && !cancelled) setMarksAlarm(true);
      });
      if (settled !== loaded.cfg && loaded.existed)
        void putMarks(settled, loaded.cfg, true).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, fetchMarks, putMarks]);

  /** Apply a pure transform, seal, PUT — retrying once against a fresh record
   *  on a 409 (the phone and the desk may both have marked something). */
  async function saveMarks(
    apply: (base: GuMarksConfig) => GuMarksConfig,
  ): Promise<void> {
    if (!marks || !doc) return;
    setBusy(true);
    setNotice(null);
    try {
      let base = marks;
      let existed = marksExisted;
      let r = await putMarks(apply(base), base, existed);
      if (r.state === "conflict") {
        const fresh = await fetchMarks();
        base = reconcileMarks(fresh.cfg, doc.sealed.refining ?? []);
        existed = true;
        r = await putMarks(apply(base), base, existed);
      }
      if (r.state !== "ok") {
        setNotice("could not save the mark — try again");
        return;
      }
      setMarks(r.written);
      setMarksExisted(true);
    } catch {
      setNotice("could not save the mark — try again");
    } finally {
      setBusy(false);
    }
  }

  const blocks = useMemo(
    () => (doc ? guBlocks(doc.sealed.paths, today, repoPushes) : []),
    [doc, today, repoPushes],
  );
  const held = useMemo(
    () => (doc ? guReads(doc.sealed.held, today, repoPushes) : []),
    [doc, today, repoPushes],
  );
  const census = useMemo(() => guCensus(blocks, held), [blocks, held]);
  // The casts: the seal's, plus the site's own unsealed ones — a cast marked
  // from the pane joins the meter and the ledger at once and reads "unsealed"
  // until Wednesday's seal carries it. The month's figure feeds the meter; the
  // ledger is every cast there has ever been (ADR 0176).
  const casts = useMemo(() => {
    const pending =
      marks && doc ? unsealedCasts(marks, doc.sealed.refining ?? []) : [];
    const all = [...(doc?.sealed.consumables?.casts ?? []), ...pending];
    return {
      month: castsThisMonth(all, today),
      ledger: ledgerEntries(all),
      unsealed: new Set(pending.map((c) => `${c.date}|${c.name}`)),
    };
  }, [doc, marks, today]);
  const book = useMemo(
    () => bookEntries(doc?.sealed.refining ?? [], marks?.marks ?? {}),
    [doc, marks],
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
  const { rented, consumables, refining, almanac } = doc.sealed;
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
        {blocks.length === 0 && held.length === 0 ? (
          <p className="text-xs text-muted">nothing inventoried yet</p>
        ) : (
          <GuGroups blocks={blocks} held={held} />
        )}
        {rented && rented.length > 0 && (
          <p className="mt-3 text-[11px] text-muted">
            rented · {rented.join(" · ")}
          </p>
        )}
        <Flavor>
          a ring is past its interval · a dim ring is a rock · essence bears the
          path
        </Flavor>
      </Section>

      {consumables && (
        <Section
          label="consumables"
          right={
            casts.ledger.length > 0 ? `${casts.ledger.length} cast` : undefined
          }
        >
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
            <span className="text-fg/80">{aud(casts.month.stones / 100)}</span>{" "}
            this month · regenerates with the week
          </p>
          <LedgerBand
            entries={casts.ledger}
            unsealed={casts.unsealed}
            today={today}
            onClear={
              busy
                ? undefined
                : (name) => saveMarks((b) => withCast(b, name, null))
            }
          />
          <Flavor>
            every cast, month by month — a ledger to be read, never a score
          </Flavor>
        </Section>
      )}

      {almanac && almanac.length > 0 && (
        <AlmanacBand entries={almanacGroups(almanac, today)} />
      )}

      {refining && refining.length > 0 && (
        <Section label="gu known" right={countsLine(bookCounts(book))}>
          {marksAlarm && (
            <div className="mb-3">
              <SeqAlarm what="gu marks" />
            </div>
          )}
          {book.length === 0 ? (
            <p className="text-xs text-muted">
              every known gu is cast — the seal turns the page
            </p>
          ) : (
            <BookBand
              entries={book}
              today={today}
              busy={busy || marks === null}
              onSince={(name, since) =>
                void saveMarks((b) => withSince(b, name, since))
              }
              onCast={(name, cast) =>
                void saveMarks((b) => withCast(b, name, cast))
              }
            />
          )}
          {notice && <p className="mt-2 text-[11px] text-amber">{notice}</p>}
          <Flavor>
            the book of every gu known at his level — a page to be read, never a
            list owed. ▸ marks one being refined.
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

/** The book header's right side: what is known, and how much of it is moving. */
function countsLine(c: { known: number; refining: number }): string {
  const known = `${c.known} known`;
  return c.refining === 0 ? known : `${known} · ${c.refining} refining`;
}

/** One bordered band, labelled in the register the inward page reads in. */
function Section({
  label,
  right,
  children,
}: {
  label: string;
  right?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-hairline px-4 py-4">
      <p className="mb-2.5 flex items-baseline gap-2 text-[11px] uppercase tracking-[0.2em] text-muted">
        <span>{label}</span>
        {right && (
          <span className="ml-auto normal-case tracking-normal tabular-nums">
            {right}
          </span>
        )}
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

/** The chevron every folding row leads with — the sheet's, verbatim. */
function Chevron({ open }: { open: boolean }) {
  return (
    <span aria-hidden className="w-2 shrink-0 text-[10px] text-muted/60">
      {open ? "▾" : "▸"}
    </span>
  );
}

/**
 * A set of names toggled one at a time — the fold state of a band. Anchored in
 * the band, so it unmounts with the document and every unlock opens folded.
 */
function useFolds(initial: readonly string[] = []) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initial));
  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  return { open, toggle };
}

/** Held by the house rather than by a road — the path-less list, read as one
 *  more group so the band has one shape. Named so no real path can collide. */
const NO_PATH = "no path";

/**
 * The held band: one row per path (or sub-path) that holds gu, the path-less
 * list last. Rows fold; the strip carries every gu's state, so nothing folded
 * is hidden — the unfold only adds names and clocks.
 */
function GuGroups({ blocks, held }: { blocks: GuBlock[]; held: GuRead[] }) {
  const { open, toggle } = useFolds();
  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((b) => (
        <GuGroup
          key={b.name}
          name={b.name}
          attainment={b.attainment}
          reads={b.gu}
          open={open.has(b.name)}
          onToggle={() => toggle(b.name)}
        />
      ))}
      {held.length > 0 && (
        <GuGroup
          name={NO_PATH}
          reads={held}
          open={open.has(NO_PATH)}
          onToggle={() => toggle(NO_PATH)}
          flavor="held by the house rather than by a road."
        />
      )}
    </div>
  );
}

/** One group: the folding row and, open, the rows it stands for. The count is
 *  inventory — how many — never how many are hungry. */
function GuGroup({
  name,
  attainment,
  reads,
  open,
  onToggle,
  flavor,
}: {
  name: string;
  attainment?: string;
  reads: GuRead[];
  open: boolean;
  onToggle: () => void;
  flavor?: string;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-xs"
      >
        <Chevron open={open} />
        <span className="w-[140px] shrink-0 truncate text-fg/90 sm:w-[148px]">
          {name}
        </span>
        {/* The rung hides on the phone — the unfold's path card on /aperture
            carries it, and the strip needs the width more. */}
        <span className="hidden w-24 shrink-0 truncate text-[11px] text-muted/60 sm:inline">
          {attainment}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-[3px]">
          {reads.map((r, i) => (
            <FeedingDot key={`${r.gu.name}-${i}`} read={r} />
          ))}
        </span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">
          {reads.length}
        </span>
      </button>
      {open && (
        <div className="mt-1 mb-1 ml-5">
          <div className="flex flex-col gap-1">
            {reads.map((r, i) => (
              <GuRow key={`${r.gu.name}-${i}`} read={r} />
            ))}
          </div>
          {flavor && (
            <p className="mt-1.5 text-[11px] italic text-muted/60">{flavor}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One gu on the strip, drawn from the same read as its row (`feedingDot`) so the
 * strip and the unfold can never disagree. Essence for the bearer, muted for
 * the merely held; hollow past the interval; dimmed whole as a rock, exactly as
 * the row dims.
 */
function FeedingDot({ read }: { read: GuRead }) {
  const { bears, ring, rock } = feedingDot(read);
  const fill = ring
    ? bears
      ? "border border-(--essence)"
      : "border border-muted"
    : bears
      ? "bg-(--essence)"
      : "bg-muted/40";
  return (
    <span
      aria-hidden
      className={`size-2 shrink-0 rounded-full ${fill} ${rock ? "opacity-40" : ""}`}
    />
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

/**
 * The cast ledger (ADR 0176): every cast the seal holds, newest first, ten to a
 * page, the month as the group header — the book's window with months where the
 * book has ranks, and no pane, since a cast has nothing to unfold. The first
 * page opens on the running month even when it is empty (`ledgerPage`), so the
 * band never says "none"; the pager and the key hints appear only once there is
 * a second page to turn to. A row the site marked itself reads "unsealed" with
 * the way back, exactly as the fold did.
 */
function LedgerBand({
  entries,
  unsealed,
  today,
  onClear,
}: {
  entries: LedgerEntry[];
  unsealed: ReadonlySet<string>;
  today: string;
  onClear?: (name: string) => void;
}) {
  const [selKey, setSelKey] = useState<string | null>(null);
  const idBase = useId();
  const keyOf = (e: LedgerEntry) => `${e.cast.date}|${e.cast.name}`;
  const selIdx = Math.max(
    0,
    entries.findIndex((e) => keyOf(e) === selKey),
  );
  const page = Math.floor(selIdx / BOOK_PAGE);
  const pages = bookPageCount(entries.length);
  const selected = entries[selIdx];
  const rows = ledgerPage(entries, page, today);

  const select = (i: number) => {
    if (entries.length === 0) return;
    const clamped = Math.max(0, Math.min(entries.length - 1, i));
    setSelKey(keyOf(entries[clamped]));
  };
  const flip = (d: number) => {
    const next = Math.max(0, Math.min(pages - 1, page + d));
    if (next !== page) select(next * BOOK_PAGE);
  };
  const onKey = (ev: React.KeyboardEvent) => {
    switch (ev.key) {
      case "ArrowDown":
      case "j":
        select(selIdx + 1);
        break;
      case "ArrowUp":
      case "k":
        select(selIdx - 1);
        break;
      case "ArrowRight":
      case "n":
        flip(1);
        break;
      case "ArrowLeft":
      case "p":
        flip(-1);
        break;
      case "Home":
        select(0);
        break;
      case "End":
        select(entries.length - 1);
        break;
      default:
        return;
    }
    ev.preventDefault();
  };
  const optId = (n: number) => `${idBase}-${n}`;

  return (
    <>
      <div
        role="listbox"
        tabIndex={0}
        aria-label="the cast ledger"
        aria-activedescendant={selected ? optId(selected.n) : undefined}
        onKeyDown={onKey}
        className={`mt-2.5 outline-none ${pages > 1 ? "min-h-[264px]" : ""}`}
      >
        {rows.map((row) =>
          row.kind === "header" ? (
            <div
              key={`h-${row.label}`}
              className="flex items-baseline gap-2 text-[11px] leading-[22px] tracking-[0.2em] text-muted uppercase"
            >
              <span>{row.label}</span>
              <span aria-hidden className="h-px flex-1 bg-hairline" />
              <span className="tracking-normal tabular-nums">
                {row.count === 0
                  ? "—"
                  : `${row.count} · ${aud(row.stones / 100)}`}
              </span>
            </div>
          ) : (
            <LedgerRow
              key={keyOf(row.entry)}
              id={optId(row.entry.n)}
              entry={row.entry}
              selected={row.entry.n - 1 === selIdx}
              unsealed={unsealed.has(keyOf(row.entry))}
              onSelect={() => select(row.entry.n - 1)}
              onClear={
                onClear && unsealed.has(keyOf(row.entry))
                  ? () => onClear(row.entry.cast.name)
                  : undefined
              }
            />
          ),
        )}
      </div>
      {pages > 1 && (
        <div className="mt-2 flex items-baseline justify-between gap-3 text-[11px] tabular-nums text-muted">
          <span>{bookStatus(entries.length, page)}</span>
          <span className="flex items-baseline gap-2">
            <span className="hidden text-muted/60 sm:inline">
              ↑↓ move · ←→ page
            </span>
            <button
              type="button"
              onClick={() => flip(-1)}
              disabled={page === 0}
              aria-label="previous page"
              className="px-1 hover:text-amber disabled:opacity-30"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => flip(1)}
              disabled={page >= pages - 1}
              aria-label="next page"
              className="px-1 hover:text-amber disabled:opacity-30"
            >
              ›
            </button>
          </span>
        </div>
      )}
    </>
  );
}

/** One line of the ledger: the day of the month where the book prints its
 *  number, the name, the kind on desktop, the stones on the right — and, for a
 *  cast the site marked itself, that it waits on the seal, with the way back. */
function LedgerRow({
  id,
  entry,
  selected,
  unsealed,
  onSelect,
  onClear,
}: {
  id: string;
  entry: LedgerEntry;
  selected: boolean;
  unsealed: boolean;
  onSelect: () => void;
  onClear?: () => void;
}) {
  const { cast } = entry;
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={`-mx-1.5 flex cursor-pointer items-baseline gap-2 px-1.5 text-xs leading-[22px] hover:bg-fg/5 ${
        selected ? "bg-fg/8 shadow-[inset_3px_0_0_var(--essence)]" : ""
      }`}
    >
      <span className="w-5 shrink-0 text-[11px] tabular-nums text-muted/50">
        {cast.date.slice(8, 10)}
      </span>
      <span aria-hidden className="w-3 shrink-0 text-[10px] text-muted/40">
        ·
      </span>
      <span className="min-w-0 flex-1 truncate text-fg/90">{cast.name}</span>
      {unsealed && (
        <span className="shrink-0 text-[10px] text-muted/60">
          unsealed
          {onClear && (
            <>
              {" · "}
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onClear();
                }}
                className="hover:text-amber"
              >
                clear
              </button>
            </>
          )}
        </span>
      )}
      {cast.type && (
        <span className="hidden shrink-0 text-[11px] text-muted/70 sm:inline">
          {cast.type}
        </span>
      )}
      {cast.stones !== undefined && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted">
          {aud(cast.stones / 100)}
        </span>
      )}
    </div>
  );
}

/**
 * The almanac (ADR 0174): what the world is producing, windowed to today.
 * Three groups — ripe now, next, any week — and RIPE NOW OPENS BY ITSELF, the
 * one fold on the page that does: the band exists to answer "what's ripe"
 * without a tap. The other two fold to a row and a count. A menu, never a
 * list of things owed: no count of what wasn't picked, no dimming as a
 * window closes, no buttons — a cast is a journal line, sealed at the
 * check-in. Free feeds print first and wear the strip's soft essence, the
 * "cheap" tone rather than the bearer's.
 */
const RIPE = "ripe now";
const NEXT = "next";
const ANY_WEEK = "any week";

function AlmanacBand({
  entries,
}: {
  entries: { ripe: AlmanacRead[]; next: AlmanacRead[]; ambient: AlmanacRead[] };
}) {
  const { open, toggle } = useFolds([RIPE]);
  const rows = useFolds();
  const groups: [string, AlmanacRead[]][] = [
    [RIPE, entries.ripe],
    [NEXT, entries.next],
    [ANY_WEEK, entries.ambient],
  ];
  return (
    <Section label="almanac">
      <div className="flex flex-col gap-1.5">
        {groups.map(([name, reads]) => (
          <div key={name}>
            <button
              type="button"
              onClick={() => toggle(name)}
              aria-expanded={open.has(name)}
              className="flex w-full items-baseline gap-2 text-left text-xs"
            >
              <Chevron open={open.has(name)} />
              <span className="text-fg/90">{name}</span>
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">
                {reads.length}
              </span>
            </button>
            {open.has(name) && (
              <div className="mt-1 mb-1 ml-5 flex flex-col gap-1.5">
                {reads.length === 0 ? (
                  <p className="text-[11px] text-muted">nothing in season</p>
                ) : (
                  reads.map((r, i) => {
                    const key = `${name}-${r.entry.name}-${i}`;
                    return (
                      <AlmanacRow
                        key={key}
                        read={r}
                        open={rows.open.has(key)}
                        onToggle={() => rows.toggle(key)}
                      />
                    );
                  })
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <Flavor>
        what the world is producing — picked from, never owed. ◦ costs nothing
        but the choosing.
      </Flavor>
    </Section>
  );
}

/**
 * One feed: a free mark or a plain one, the name, when, and the mouths it
 * feeds where there is room (they ride in the unfold on the phone). The
 * unfold is its source, its cost, the note, and what it pairs with; a row
 * with nothing to unfold is its own whole entry.
 */
function AlmanacRow({
  read,
  open,
  onToggle,
}: {
  read: AlmanacRead;
  open: boolean;
  onToggle: () => void;
}) {
  const { entry, when } = read;
  const free = entry.free === true;
  const feeds = entry.feeds ?? [];
  const cost = free ? "free" : entry.tier ? `rank ${entry.tier}` : null;
  const detail = [entry.source, cost, entry.note].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const hasBody =
    detail.length > 0 || entry.pair !== undefined || feeds.length > 0;
  const row = (
    <>
      <span aria-hidden className="w-2 shrink-0 text-[10px] text-muted/60">
        {hasBody ? (open ? "▾" : "▸") : "·"}
      </span>
      <span
        aria-hidden
        className={`w-2.5 shrink-0 ${free ? "text-(--essence-soft)" : "text-muted/40"}`}
      >
        {free ? "◦" : "·"}
      </span>
      <span className="min-w-0 flex-1 truncate text-fg/90 sm:w-[268px] sm:flex-none">
        {entry.name}
      </span>
      {when && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted">
          {when}
        </span>
      )}
      {feeds.length > 0 && (
        <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted/60 sm:block">
          {feeds.join(" · ")}
        </span>
      )}
    </>
  );
  return (
    <div>
      {hasBody ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-baseline gap-2 text-left text-xs"
        >
          {row}
        </button>
      ) : (
        <p className="flex items-baseline gap-2 text-xs">{row}</p>
      )}
      {open && hasBody && (
        <div className="mt-0.5 mb-1 ml-5 flex flex-col gap-0.5 text-[11px] text-muted">
          {feeds.length > 0 && (
            <p className="text-muted/60 sm:hidden">feeds {feeds.join(" · ")}</p>
          )}
          {detail.length > 0 && (
            <p>
              {detail.map((d, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  <span className={d === cost ? "text-fg/80" : undefined}>
                    {d}
                  </span>
                </span>
              ))}
            </p>
          )}
          {entry.pair && <p>pairs with · {entry.pair}</p>}
        </div>
      )}
    </div>
  );
}

// --- the book (ADR 0175) ---------------------------------------------------------

const inputCls =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btnCls =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/** `2026-09-05` → `5 sep` — the almanac's day word, for a start date. */
function sinceWord(iso: string): string {
  const m = Number(iso.slice(5, 7));
  return `${Number(iso.slice(8, 10))} ${MONTHS[m - 1] ?? ""}`.trim();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * The book as an old-school menu (ADR 0175): one line per gu, ten to a page,
 * rank as inline group headers, one description pane for the selected row —
 * beside the list on desktop, under it on the phone — and a status line in
 * the pager's idiom. The band's height no longer moves with the count.
 *
 * Selection is the entry's NAME, so a row that re-sorts (a mark sets its
 * start and it rises to the top of its rank) stays selected and the page
 * follows it; the page is derived, never stored. Keys work only while the
 * list has focus — arrows primary, j/k/n/p as aliases — so nothing here
 * fights ⌘K. No memory: every unlock opens on row one.
 */
function BookBand({
  entries,
  today,
  busy,
  onSince,
  onCast,
}: {
  entries: BookEntry[];
  today: string;
  busy: boolean;
  onSince: (name: string, since: string | null) => void;
  onCast: (name: string, cast: GuCastMark | null) => void;
}) {
  const [selName, setSelName] = useState<string | null>(null);
  const [castOpen, setCastOpen] = useState(false);
  const idBase = useId();
  const selIdx = Math.max(
    0,
    entries.findIndex((e) => e.entry.name === selName),
  );
  const page = Math.floor(selIdx / BOOK_PAGE);
  const pages = bookPageCount(entries.length);
  const selected = entries[selIdx];
  const rows = bookPage(entries, page);

  const select = (i: number) => {
    const clamped = Math.max(0, Math.min(entries.length - 1, i));
    setSelName(entries[clamped].entry.name);
    setCastOpen(false);
  };
  const flip = (d: number) => {
    const next = Math.max(0, Math.min(pages - 1, page + d));
    if (next !== page) select(next * BOOK_PAGE);
  };
  const onKey = (ev: React.KeyboardEvent) => {
    switch (ev.key) {
      case "ArrowDown":
      case "j":
        select(selIdx + 1);
        break;
      case "ArrowUp":
      case "k":
        select(selIdx - 1);
        break;
      case "ArrowRight":
      case "n":
        flip(1);
        break;
      case "ArrowLeft":
      case "p":
        flip(-1);
        break;
      case "Home":
        select(0);
        break;
      case "End":
        select(entries.length - 1);
        break;
      default:
        return;
    }
    ev.preventDefault();
  };
  const optId = (n: number) => `${idBase}-${n}`;

  return (
    <>
      <div className="sm:grid sm:grid-cols-[11fr_9fr]">
        <div
          role="listbox"
          tabIndex={0}
          aria-label="the gu book"
          aria-activedescendant={selected ? optId(selected.n) : undefined}
          onKeyDown={onKey}
          className="min-h-[264px] outline-none focus-visible:ring-1 focus-visible:ring-hairline"
        >
          {rows.map((row) =>
            row.kind === "header" ? (
              <div
                key={`h-${row.label}`}
                className="flex items-baseline gap-2 text-[11px] leading-[22px] tracking-[0.2em] text-muted uppercase"
              >
                <span>{row.label}</span>
                <span aria-hidden className="h-px flex-1 bg-hairline" />
                <span className="tracking-normal tabular-nums">
                  {row.count}
                </span>
              </div>
            ) : (
              <BookRow
                key={row.entry.entry.name}
                id={optId(row.entry.n)}
                entry={row.entry}
                selected={row.entry.n - 1 === selIdx}
                onSelect={() => select(row.entry.n - 1)}
              />
            ),
          )}
        </div>
        {selected && (
          <BookPane
            entry={selected}
            today={today}
            busy={busy}
            castOpen={castOpen}
            setCastOpen={setCastOpen}
            onSince={onSince}
            onCast={onCast}
          />
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3 text-[11px] tabular-nums text-muted">
        <span>{bookStatus(entries.length, page)}</span>
        <span className="flex items-baseline gap-2">
          <span className="hidden text-muted/60 sm:inline">
            ↑↓ move · ←→ page
          </span>
          <button
            type="button"
            onClick={() => flip(-1)}
            disabled={page === 0}
            aria-label="previous page"
            className="px-1 hover:text-amber disabled:opacity-30"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => flip(1)}
            disabled={page >= pages - 1}
            aria-label="next page"
            className="px-1 hover:text-amber disabled:opacity-30"
          >
            ›
          </button>
        </span>
      </div>
    </>
  );
}

/** One line of the book: number, the refining mark, the name, and on desktop
 *  the start date; the highlight bar is the terminal's, not a cursor glyph. */
function BookRow({
  id,
  entry,
  selected,
  onSelect,
}: {
  id: string;
  entry: BookEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={`-mx-1.5 flex cursor-pointer items-baseline gap-2 px-1.5 text-xs leading-[22px] hover:bg-fg/5 ${
        selected ? "bg-fg/8 shadow-[inset_3px_0_0_var(--essence)]" : ""
      }`}
    >
      <span className="w-5 shrink-0 text-[11px] tabular-nums text-muted/50">
        {pad(entry.n)}
      </span>
      <span
        aria-hidden
        className={`w-3 shrink-0 text-[10px] ${
          entry.since ? "text-(--essence)" : "text-muted/40"
        }`}
      >
        {entry.since ? "▸" : "·"}
      </span>
      <span className="min-w-0 flex-1 truncate text-fg/90">
        {entry.entry.name}
      </span>
      {entry.since && (
        <span className="hidden shrink-0 text-[11px] tabular-nums text-(--essence-soft) sm:inline">
          since {sinceWord(entry.since)}
        </span>
      )}
    </div>
  );
}

function PaneLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="mt-0.5 flex gap-2">
      <span className="w-9 shrink-0 text-muted/60">{label}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * The selected entry, read in full, and the two marks the owner can make:
 * refining (any entry — cleared by a second tap while unsealed; a start the
 * seal carries is shown, not toggled) and cast (consumables only, through the
 * small form). The rule beside the button is the rule from the ADR.
 */
function BookPane({
  entry,
  today,
  busy,
  castOpen,
  setCastOpen,
  onSince,
  onCast,
}: {
  entry: BookEntry;
  today: string;
  busy: boolean;
  castOpen: boolean;
  setCastOpen: (open: boolean) => void;
  onSince: (name: string, since: string | null) => void;
  onCast: (name: string, cast: GuCastMark | null) => void;
}) {
  const e = entry.entry;
  const consumable = /^consumable/i.test(e.type);
  const tag = "text-[10px] text-muted/60";
  return (
    <div className="mt-3 text-[11px] leading-[1.55] text-muted sm:mt-0 sm:ml-3.5 sm:border-l sm:border-hairline sm:pl-3.5">
      <p className="mb-0.5 text-xs text-fg">
        <span className="text-[11px] tabular-nums text-muted/50">
          {pad(entry.n)}
        </span>{" "}
        {e.name}
      </p>
      <PaneLine label="is">
        rank {e.rank} · {e.type}
        {entry.since && (
          <>
            {" "}
            · refining since {sinceWord(entry.since)}
            {entry.unsealed && " · unsealed"}
          </>
        )}
      </PaneLine>
      <PaneLine label="test">{e.test}</PaneLine>
      {e.needs && <PaneLine label="needs">{e.needs}</PaneLine>}
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 border-t border-hairline/60 pt-2">
        {e.since !== undefined ? (
          <>
            <span className="text-(--essence)">
              ● refining · since {sinceWord(e.since)}
            </span>
            <span className={tag}>sealed</span>
          </>
        ) : entry.since ? (
          <>
            <button
              type="button"
              onClick={() => onSince(e.name, null)}
              disabled={busy}
              className="text-(--essence) hover:text-amber disabled:opacity-50"
            >
              ● refining · since {sinceWord(entry.since)}
            </button>
            <span className={tag}>unsealed · folds in at the check-in</span>
            <span className={tag}>tap to clear</span>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onSince(e.name, today)}
              disabled={busy}
              className="hover:text-amber disabled:opacity-50"
            >
              ○ refining
            </button>
            <span className={tag}>
              first material in hand + the plan to finish
            </span>
          </>
        )}
        {consumable && !castOpen && (
          <button
            type="button"
            onClick={() => setCastOpen(true)}
            disabled={busy}
            className="ml-auto hover:text-amber disabled:opacity-50"
          >
            cast
          </button>
        )}
      </div>
      {consumable && castOpen && (
        <CastForm
          today={today}
          busy={busy}
          onCancel={() => setCastOpen(false)}
          onConfirm={(cast) => {
            setCastOpen(false);
            onCast(e.name, cast);
          }}
        />
      )}
    </div>
  );
}

/** The cast: what it cost, in dollars, and the day — today unless said otherwise. */
function CastForm({
  today,
  busy,
  onCancel,
  onConfirm,
}: {
  today: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (cast: GuCastMark) => void;
}) {
  const [dollars, setDollars] = useState("");
  const [date, setDate] = useState(today);
  const cents =
    dollars.trim() === "" ? undefined : Math.round(Number(dollars) * 100);
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    (cents === undefined || (Number.isInteger(cents) && cents >= 0));
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!valid) return;
        onConfirm({ date, ...(cents !== undefined ? { stones: cents } : {}) });
      }}
      className="mt-2 flex flex-wrap items-center gap-2 text-xs"
    >
      <label className="flex items-center gap-1 text-muted">
        $
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={dollars}
          onChange={(ev) => setDollars(ev.target.value)}
          placeholder="0.00"
          aria-label="stones, in dollars"
          className={`w-20 ${inputCls}`}
        />
      </label>
      <input
        type="date"
        value={date}
        onChange={(ev) => setDate(ev.target.value)}
        aria-label="cast on"
        className={inputCls}
      />
      <button type="submit" disabled={busy || !valid} className={btnCls}>
        cast it
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-muted hover:text-amber"
      >
        cancel
      </button>
    </form>
  );
}
