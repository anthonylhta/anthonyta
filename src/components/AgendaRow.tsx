"use client";

import { useState } from "react";
import Link from "next/link";
import { AgendaComposer, type AgendaPreset } from "@/components/AgendaComposer";
import { SeqAlarm } from "@/components/SeqAlarm";
import { useAgenda } from "@/components/useAgenda";
import {
  addEvent,
  BOOK_AHEAD_DAYS,
  dayLabel,
  removeEvent,
  timeLabel,
  upcoming,
  type AgendaEvent,
} from "@/lib/agenda";
import { nextDays } from "@/lib/transit";

/** Rows the glance draws before it summarises the tail. */
const GLANCE_COUNT = 5;

/**
 * The agenda row — what's ahead, and the one place on the homepage to put
 * something there. The envelope, the decrypt and the save all live in
 * `useAgenda`, and the typing in `AgendaComposer`, so this is the glance itself
 * and nothing else; /agenda draws the same schedule from the same two pieces.
 *
 * Always rendered, like the needs-doing board: ADR 0109's silent-when-fine rule
 * is for rows that report, and an entry surface has to exist to be entered into.
 */
export function AgendaRow({
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

  // Composer — closed until asked for, and remounted on each preset so a `+1`
  // lands its values in fresh fields.
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

  /** `+1` — the same thing on another day: the composer opens carrying the
   *  event's text and times, and nothing is saved until `add`. */
  function repeat(event: AgendaEvent) {
    setPreset({ title: event.title, start: event.start, end: event.end });
    setPresetNonce((n) => n + 1);
    setOpen(true);
    clearNotice();
  }

  // --- render ---

  if (!cfg) {
    return (
      <span className="text-xs text-muted">
        {status === "unreachable" ? (
          <span className="text-down">vault unreachable — reload to retry</span>
        ) : status === "tamper" ? (
          <span className="text-down">cannot decrypt — lock and unlock</span>
        ) : status === "loading" ? (
          "decrypting…"
        ) : (
          <span className="text-muted/40">···</span>
        )}
      </span>
    );
  }

  const ahead = upcoming(cfg, today);
  const shown = ahead.slice(0, GLANCE_COUNT);
  const hiddenCount = ahead.length - shown.length;
  // Anchored on the server's Sydney day, not the device clock — stale only
  // until the next page load, like every `today` reading in this zone.
  const dayOptions = nextDays(BOOK_AHEAD_DAYS, new Date(`${today}T00:00:00`));

  return (
    <div className="flex items-baseline gap-3">
      <div className="min-w-0 flex-1">
        {seqAlarm && <SeqAlarm what="agenda" />}

        {ahead.length === 0 ? (
          <p className="text-xs text-muted">nothing ahead</p>
        ) : (
          shown.map((e) => (
            <div key={e.id} className="flex items-baseline gap-2.5 py-0.5">
              <span
                className={`w-9 shrink-0 text-[11px] ${
                  e.date === today ? "text-amber" : "text-muted/60"
                }`}
              >
                {dayLabel(e.date, today)}
              </span>
              <span className="w-[88px] shrink-0 text-xs tabular-nums text-muted">
                {timeLabel(e)}
              </span>
              <span className="min-w-0 flex-1 break-words text-fg/90">
                {e.title}
              </span>
              <button
                type="button"
                title="repeat on another day"
                disabled={busy}
                onClick={() => repeat(e)}
                className="shrink-0 text-[11px] text-muted/50 transition-colors hover:text-amber disabled:opacity-30"
              >
                +1
              </button>
              <button
                type="button"
                aria-label="remove event"
                disabled={busy}
                onClick={() => void saveConfig((b) => removeEvent(b, e.id))}
                className="shrink-0 text-xs text-muted/50 transition-colors hover:text-down disabled:opacity-30"
              >
                ×
              </button>
            </div>
          ))
        )}

        {/* The tail isn't summarised away — it's a door: the whole schedule, week
            and month, is one tap down at /agenda. */}
        {hiddenCount > 0 && (
          <p className="pt-0.5 text-[11px] text-muted/60">
            <Link href="/agenda" className="transition-colors hover:text-amber">
              +{hiddenCount} more within 14d
            </Link>
          </p>
        )}

        {open && (
          <AgendaComposer
            key={presetNonce}
            busy={busy}
            dayOptions={dayOptions}
            initial={preset}
            onAdd={(event) => saveConfig((base) => addEvent(base, event))}
          />
        )}

        {notice && <p className="pt-1 text-[11px] text-down">{notice}</p>}
      </div>

      <button
        type="button"
        aria-label={open ? "close composer" : "add an event"}
        onClick={() => setOpen(!open)}
        className="shrink-0 text-xs text-muted/50 transition-colors hover:text-amber"
      >
        {open ? "×" : "+"}
      </button>
    </div>
  );
}
