"use client";

import { useState } from "react";
import Link from "next/link";
import { AgendaComposer, type AgendaPreset } from "@/components/AgendaComposer";
import { SeqAlarm } from "@/components/SeqAlarm";
import { useAgenda } from "@/components/useAgenda";
import {
  addEvent,
  BOOK_AHEAD_DAYS,
  clampMonth,
  dayEvents,
  monthGrid,
  monthLabel,
  monthOf,
  nextDates,
  removeEvent,
  shiftMonth,
  shortDayLabel,
  timeLabel,
  type AgendaConfig,
  type AgendaEvent,
} from "@/lib/agenda";
import { nextDays } from "@/lib/transit";

type View = "week" | "month";

const VIEWS: View[] = ["week", "month"];

/** The rolling window the week view draws — days, not a calendar week: what's
 *  ahead from today is the reading, and a Monday-start week would spend half
 *  itself on the past. */
const WEEK_DAYS = 7;

const WEEK_HEADS = ["mo", "tu", "we", "th", "fr", "sa", "su"];

/** What a day's row hands back up: the same two edits the homepage row has. */
interface DayHandlers {
  busy: boolean;
  onRepeat: (event: AgendaEvent) => void;
  onRemove: (id: string) => void;
}

/**
 * /agenda — the whole schedule, as the week ahead and as the month it sits in.
 * Second surface on the same envelope: the fetch, the decrypt and the save all
 * come from `useAgenda`, the typing from `AgendaComposer`, so this page and the
 * homepage row cannot drift apart. Nothing here is new data — it is the same
 * events, read at two more useful distances.
 */
export function AgendaViews({
  offline,
  today,
}: {
  offline: boolean;
  today: string;
}) {
  const {
    status,
    cfg,
    unlocked,
    busy,
    notice,
    seqAlarm,
    saveConfig,
    clearNotice,
  } = useAgenda(offline, today);

  const [view, setView] = useState<View>("week");
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<AgendaPreset | null>(null);
  const [presetNonce, setPresetNonce] = useState(0);

  // The lock edge closes the composer: anything half-typed about the schedule
  // leaves with the key, exactly as the decrypted schedule does.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setOpen(false);
    setPreset(null);
  }

  /** Open the composer on a preset — the nonce remounts it, so the values land
   *  in fresh fields rather than being synced into live ones. */
  function compose(next: AgendaPreset | null) {
    setPreset(next);
    setPresetNonce((n) => n + 1);
    setOpen(true);
    clearNotice();
  }

  const handlers: DayHandlers = {
    busy,
    onRepeat: (event) =>
      compose({ title: event.title, start: event.start, end: event.end }),
    onRemove: (id) => void saveConfig((base) => removeEvent(base, id)),
  };

  // --- render ---

  if (!cfg) {
    return (
      <div className="px-4 py-4">
        <p className="text-xs text-muted">
          {status === "unreachable" ? (
            <span className="text-down">
              vault unreachable — reload to retry
            </span>
          ) : status === "tamper" ? (
            <span className="text-down">cannot decrypt — lock and unlock</span>
          ) : status === "loading" ? (
            "decrypting…"
          ) : (
            <>
              {VIEWS.join(" · ")} <span className="text-muted/40">·····</span>{" "}
              sealed —{" "}
              <Link href="/files" className="text-amber hover:underline">
                unlock in files →
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }

  // Anchored on the server's Sydney day, not the device clock — the same list the
  // homepage row books from, so neither surface offers a day the other refuses.
  const dayOptions = nextDays(BOOK_AHEAD_DAYS, new Date(`${today}T00:00:00`));

  return (
    <div className="flex flex-col">
      {seqAlarm && (
        <div className="px-4 pt-4">
          <SeqAlarm what="agenda" />
        </div>
      )}

      <nav className="flex items-center gap-4 border-b border-hairline px-4 py-2 text-xs">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={
              v === view
                ? "text-amber"
                : "text-muted transition-colors hover:text-amber"
            }
          >
            {v}
          </button>
        ))}
        <button
          type="button"
          aria-label={open ? "close composer" : "add an event"}
          onClick={() => (open ? setOpen(false) : compose(null))}
          className={`ml-auto transition-colors hover:text-amber ${
            open ? "text-amber" : "text-muted"
          }`}
        >
          + add
        </button>
      </nav>

      {open && (
        <div className="border-b border-hairline px-4 pb-2.5">
          <AgendaComposer
            key={presetNonce}
            busy={busy}
            dayOptions={dayOptions}
            initial={preset}
            onAdd={(event) => saveConfig((base) => addEvent(base, event))}
          />
        </div>
      )}

      {notice && (
        <p className="border-b border-hairline px-4 py-2 text-xs text-down">
          {notice}
        </p>
      )}

      {view === "week" ? (
        <WeekView cfg={cfg} today={today} handlers={handlers} />
      ) : (
        <MonthView
          cfg={cfg}
          today={today}
          handlers={handlers}
          onAddOn={(ymd) => compose({ day: ymd })}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------------
// week — the rolling seven days, every one of them a row
// -------------------------------------------------------------------------------

function WeekView({
  cfg,
  today,
  handlers,
}: {
  cfg: AgendaConfig;
  today: string;
  handlers: DayHandlers;
}) {
  return (
    <>
      {nextDates(today, WEEK_DAYS).map((ymd) => {
        const events = dayEvents(cfg, ymd);
        return (
          <div
            key={ymd}
            className="flex gap-3 border-b border-hairline px-4 py-2"
          >
            <span className="w-16 shrink-0 text-[11px] leading-tight">
              {ymd === today && <span className="block text-amber">today</span>}
              <span className="block text-muted/60">{shortDayLabel(ymd)}</span>
            </span>
            <div className="min-w-0 flex-1">
              {/* An empty day is information — a gap you can book — so it draws a
                  dash rather than vanishing out of the week. */}
              {events.length === 0 ? (
                <span className="text-xs text-muted/40">—</span>
              ) : (
                events.map((e) => (
                  <EventRow key={e.id} event={e} handlers={handlers} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** One event, wherever it is drawn — the homepage row's line without the day
 *  chip, because both views already say which day they are on. */
function EventRow({
  event,
  handlers,
}: {
  event: AgendaEvent;
  handlers: DayHandlers;
}) {
  const { busy, onRepeat, onRemove } = handlers;
  return (
    <div className="flex items-baseline gap-2.5 py-0.5 text-[13px]">
      <span className="w-[88px] shrink-0 text-xs tabular-nums text-muted">
        {timeLabel(event)}
      </span>
      <span className="min-w-0 flex-1 break-words text-fg/90">
        {event.title}
      </span>
      <button
        type="button"
        title="repeat on another day"
        disabled={busy}
        onClick={() => onRepeat(event)}
        className="shrink-0 text-[11px] text-muted/50 transition-colors hover:text-amber disabled:opacity-30"
      >
        +1
      </button>
      <button
        type="button"
        aria-label="remove event"
        disabled={busy}
        onClick={() => onRemove(event.id)}
        className="shrink-0 text-xs text-muted/50 transition-colors hover:text-down disabled:opacity-30"
      >
        ×
      </button>
    </div>
  );
}

// -------------------------------------------------------------------------------
// month — the booking grid, and the day you tapped
// -------------------------------------------------------------------------------

function MonthView({
  cfg,
  today,
  handlers,
  onAddOn,
}: {
  cfg: AgendaConfig;
  today: string;
  handlers: DayHandlers;
  onAddOn: (ymd: string) => void;
}) {
  const minMonth = monthOf(today);
  // The walk stops at the month the booking horizon falls in: past it nothing can
  // be added, so there is nothing to go and look at.
  const maxMonth = monthOf(
    nextDates(today, BOOK_AHEAD_DAYS + 1).at(-1) ?? today,
  );
  const [month, setMonth] = useState(minMonth);
  const [selected, setSelected] = useState<string | null>(null);

  const navClass = (dead: boolean) =>
    `px-2 ${dead ? "text-muted/30" : "text-muted transition-colors hover:text-amber"}`;

  function walk(by: number) {
    setMonth(clampMonth(shiftMonth(month, by), minMonth, maxMonth));
    // The detail block follows the grid — a day from the month you just left
    // would contradict the page.
    setSelected(null);
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-2 pb-1 pt-2.5 text-xs">
        <button
          type="button"
          aria-label="previous month"
          disabled={month <= minMonth}
          onClick={() => walk(-1)}
          className={navClass(month <= minMonth)}
        >
          ‹
        </button>
        <span className="uppercase tracking-[0.15em] text-muted">
          {monthLabel(month)}
        </span>
        <button
          type="button"
          aria-label="next month"
          disabled={month >= maxMonth}
          onClick={() => walk(1)}
          className={navClass(month >= maxMonth)}
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 px-2 pb-2">
        {WEEK_HEADS.map((h) => (
          <span
            key={h}
            className="py-1 text-center text-[10px] text-muted/50"
            aria-hidden
          >
            {h}
          </span>
        ))}
        {monthGrid(month)
          .flat()
          .map((cell) =>
            cell.inMonth ? (
              <DayCell
                key={cell.ymd}
                ymd={cell.ymd}
                day={cell.day}
                today={today}
                count={dayEvents(cfg, cell.ymd).length}
                selected={cell.ymd === selected}
                onSelect={() => setSelected(cell.ymd)}
              />
            ) : (
              // The neighbouring month's days keep the rows square and say
              // nothing else — barely there, and never tappable.
              <span
                key={cell.ymd}
                className="border border-transparent py-1.5 pb-3 text-center text-xs text-fg/10"
              >
                {cell.day}
              </span>
            ),
          )}
      </div>

      <div className="border-t border-hairline px-4 py-3">
        {selected === null ? (
          <>
            <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted">
              tap a day
            </p>
            <span className="text-xs text-muted/40">its events land here</span>
          </>
        ) : (
          <DayDetail
            cfg={cfg}
            date={selected}
            handlers={handlers}
            onAddOn={onAddOn}
          />
        )}
      </div>
    </div>
  );
}

/** One day of the month. Today is amber, the days behind it are dim (the store
 *  prunes a week back, so the past empties itself — the grid shows shape, the
 *  journal owns history), and a day with something on it carries a dot. */
function DayCell({
  ymd,
  day,
  today,
  count,
  selected,
  onSelect,
}: {
  ymd: string;
  day: number;
  today: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const past = ymd < today;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${shortDayLabel(ymd)}${
        count === 0 ? "" : count === 1 ? ", 1 event" : `, ${count} events`
      }`}
      className={`relative border py-1.5 pb-3 text-center text-xs ${
        selected ? "border-amber" : "border-transparent"
      } ${ymd === today ? "text-amber" : past ? "text-muted/40" : "text-muted"}`}
    >
      {day}
      {count > 0 && (
        <span
          aria-hidden
          className={`absolute inset-x-0 bottom-0.5 text-[8px] leading-none tracking-[1px] ${
            past ? "text-muted/40" : "text-amber"
          }`}
        >
          {count > 1 ? "••" : "•"}
        </span>
      )}
    </button>
  );
}

/** The tapped day, under the grid: what is on it, and the booking flow the grid
 *  exists for — see the empty day, tap it, add, without scrolling a sixty-day
 *  picker to find it again. */
function DayDetail({
  cfg,
  date,
  handlers,
  onAddOn,
}: {
  cfg: AgendaConfig;
  date: string;
  handlers: DayHandlers;
  onAddOn: (ymd: string) => void;
}) {
  const events = dayEvents(cfg, date);
  // "wed 6 aug" — the month named short, off the full label it already has.
  const heading = `${shortDayLabel(date)} ${monthLabel(monthOf(date)).slice(0, 3)}`;
  return (
    <>
      <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted">
        {heading}
      </p>
      {events.map((e) => (
        <EventRow key={e.id} event={e} handlers={handlers} />
      ))}
      <button
        type="button"
        onClick={() => onAddOn(date)}
        className="pt-1.5 text-xs text-muted/60 transition-colors hover:text-amber"
      >
        + add on {shortDayLabel(date)}
      </button>
    </>
  );
}
