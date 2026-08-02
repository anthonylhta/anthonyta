"use client";

import { useEffect, useRef, useState } from "react";
import { parseTimeInput, shortDayLabel, type AgendaEvent } from "@/lib/agenda";
import { randomId } from "@/lib/crypto";
import type { DayOption } from "@/lib/transit";

const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

/** What a `+1` (or a tapped day) hands the composer to open with. Read ONCE, at
 *  mount — callers remount with a key rather than syncing an effect. */
export interface AgendaPreset {
  day?: string;
  start?: string;
  end?: string;
  title?: string;
}

/**
 * The one place an event is typed — shared by the homepage row and /agenda so a
 * booking behaves identically wherever it starts. Owns its own fields: they are
 * strings until `add` turns them into an event, and they live only as long as the
 * composer is open.
 */
export function AgendaComposer({
  busy,
  dayOptions,
  initial,
  onAdd,
}: {
  busy: boolean;
  dayOptions: DayOption[];
  initial?: AgendaPreset | null;
  onAdd: (event: AgendaEvent) => Promise<boolean>;
}) {
  const firstDay = dayOptions[0]?.ymd ?? "";
  const [day, setDay] = useState(initial?.day ?? firstDay);
  const [startText, setStartText] = useState(initial?.start ?? "");
  const [endText, setEndText] = useState(initial?.end ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");

  // A preset can be sent from below the fold (the month grid's day detail sits
  // under six rows of calendar), so the freshly-mounted composer pulls itself
  // into view rather than opening off-screen.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initial)
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [initial]);

  // A day tapped on the month grid can sit past the picker's horizon (the grid
  // walks whole months, the picker offers sixty days), so it JOINS the list —
  // snapping the booking silently back to today would be a lie.
  const days = dayOptions.some((d) => d.ymd === day)
    ? dayOptions
    : [...dayOptions, { ymd: day, label: shortDayLabel(day) }];

  // A blank field means "no time"; a field with something unusable in it means
  // "not yet" — which is what greys the add button rather than storing a guess.
  const start = parseTimeInput(startText);
  const end = parseTimeInput(endText);
  const timesBad =
    (startText !== "" && start === null) || (endText !== "" && end === null);
  const rangeBad =
    (endText !== "" && startText === "") ||
    (start !== null && end !== null && end <= start);
  const canAdd = !busy && title.trim() !== "" && !timesBad && !rangeBad;

  async function add() {
    if (!canAdd) return;
    // The event is built ONCE, here rather than inside the transform: `addEvent`
    // is idempotent on its id, and a fresh id per re-run would defeat that on the
    // 409 retry.
    const event: AgendaEvent = {
      id: randomId(),
      date: day,
      ...(start !== null ? { start } : {}),
      ...(start !== null && end !== null ? { end } : {}),
      title: title.trim(),
    };
    const ok = await onAdd(event);
    // The composer stays open — a roster drops several days at once — but the day
    // resets to where it OPENED (the tapped day when preset, else the first
    // option), so the next add can't inherit a mid-compose date by accident while
    // a second booking on the tapped day stays one tap away.
    if (ok) {
      setTitle("");
      setStartText("");
      setEndText("");
      setDay(initial?.day ?? firstDay);
    }
  }

  return (
    <div
      ref={rootRef}
      className="flex flex-wrap items-center gap-1.5 pt-2 text-xs"
    >
      <select
        value={day}
        disabled={busy}
        onChange={(e) => setDay(e.target.value)}
        className={input}
        aria-label="day"
      >
        {days.map((d) => (
          <option key={d.ymd} value={d.ymd}>
            {d.label}
          </option>
        ))}
      </select>
      {/* Text fields, not type="time": the native picker fights the
          terminal look, and a controlled one snaps a cleared field back
          under the cursor. The strings are the state; parseTimeInput
          decides whether they're usable. */}
      <input
        type="text"
        inputMode="numeric"
        maxLength={5}
        value={startText}
        disabled={busy}
        onChange={(e) => setStartText(e.target.value)}
        placeholder="15:00"
        className={`w-16 shrink-0 tabular-nums ${input}`}
        aria-label="start time (24h hh:mm)"
      />
      <input
        type="text"
        inputMode="numeric"
        maxLength={5}
        value={endText}
        disabled={busy}
        onChange={(e) => setEndText(e.target.value)}
        placeholder="23:00"
        className={`w-16 shrink-0 tabular-nums ${input}`}
        aria-label="end time (24h hh:mm)"
      />
      <input
        type="text"
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void add()}
        placeholder="what"
        enterKeyHint="done"
        className={`min-w-24 flex-1 ${input}`}
        aria-label="what"
      />
      <button
        type="button"
        className={btn}
        disabled={!canAdd}
        onClick={() => void add()}
      >
        {busy ? "…" : "add"}
      </button>
    </div>
  );
}
