"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import {
  checkSeqAndRemember,
  rememberSavedSeq,
  SeqAlarm,
} from "@/components/SeqAlarm";
import { AGENDA_CONTEXT } from "@/lib/aevcontext";
import {
  addEvent,
  dayLabel,
  EMPTY_AGENDA_CONFIG,
  fitsAgendaCap,
  normalizeAgendaConfig,
  parseTimeInput,
  pruneCutoff,
  pruneEvents,
  removeEvent,
  timeLabel,
  upcoming,
  type AgendaConfig,
  type AgendaEvent,
} from "@/lib/agenda";
import { randomId } from "@/lib/crypto";
import { nextSeq } from "@/lib/seqrule";
import { nextDays } from "@/lib/transit";

const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

/** Rows the glance draws before it summarises the tail. */
const GLANCE_COUNT = 5;

/** How far ahead the composer can book. Appointments land weeks out, but this is
 *  a schedule, not a calendar — past two months the year belongs elsewhere. */
const BOOK_AHEAD_DAYS = 60;

/**
 * The agenda row — what's ahead, and the one place to put something there. Every
 * event lives in the `meta/agenda` envelope, so this is a client island: one
 * fetch, one decrypt, one normalize, and the server never sees a title. Sealed
 * dots until the vault key is in hand (the IDB cache usually means it already
 * is), and the decrypted schedule leaves the moment the vault locks.
 *
 * Always rendered, like the needs-doing board: ADR 0109's silent-when-fine rule
 * is for rows that report, and an entry surface has to exist to be entered into.
 *
 * Every save is the fin panel's seal → PUT → retry-once-on-409 dance over a PURE
 * transform, re-applied against freshly-fetched state on the conflict — so adding
 * a shift on the phone while the PC has the page open can't lose either. This
 * island WRITES, so it owns the rollback check (58b) the read-only glances skip.
 * Nothing is optimistic: an event is on the page after it is sealed, not before.
 */
export function AgendaRow({
  offline,
  today,
}: {
  offline: boolean;
  today: string;
}) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<AgendaConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [seqAlarm, setSeqAlarm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Composer — closed until asked for, and its fields are strings until `add`
  // turns them into an event.
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(today);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [title, setTitle] = useState("");

  // Render-phase reset on the lock/unlock edge (the glance idiom): the decrypted
  // schedule leaves with the key, and so does anything half-typed about it.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setCfg(null);
    setDataErr(null);
    setNotice(null);
    setOpen(false);
    setTitle("");
    setStartText("");
    setEndText("");
  }

  // Load + decrypt once per unlock. A healthy 404 is first-run; other misses get
  // the honest register — this row is the store's ONLY surface (unlike the meals
  // glance, which defers its errors to /meals), so silent dots on a tampered
  // envelope would hide the one signal the owner could act on.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      let config: AgendaConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/agenda");
        if (res.status === 404) {
          config = EMPTY_AGENDA_CONFIG;
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope, AGENDA_CONTEXT);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeAgendaConfig(parsed);
            if (!config) throw new Error("bad shape");
            existed = true;
          } catch {
            if (!cancelled) setDataErr("tamper");
            return;
          }
        } else {
          if (!cancelled) setDataErr("unreachable");
          return;
        }
      } catch {
        if (!cancelled) setDataErr("unreachable");
        return;
      }
      if (cancelled) return;
      setCfg(config);
      setConfigExisted(existed);
      // Rollback check (58b) — a 404 for a schedule this device has seen alarms too.
      void checkSeqAndRemember("agenda", config).then((rolled) => {
        if (rolled && !cancelled) setSeqAlarm(true);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  async function putConfig(
    next: AgendaConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    // Bump the sealed write counter (58b); prior = the newer of loaded state
    // and next itself (a 409-dance rebuild carries the fresher seq).
    next = { ...next, seq: Math.max(nextSeq(cfg ?? {}), nextSeq(next)) };
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "agenda.json", t: "application/json", s: bytes.length },
      bytes,
      AGENDA_CONTEXT,
    );
    const res = await fetch("/api/agenda", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-agenda-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    if (res.ok) rememberSavedSeq("agenda", next);
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<AgendaConfig> {
    const res = await fetch("/api/agenda");
    if (res.status === 404) return EMPTY_AGENDA_CONFIG;
    if (res.status !== 200) throw new Error("agenda refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope, AGENDA_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeAgendaConfig(parsed);
    if (!config) throw new Error("agenda refetch: bad shape");
    return config;
  }

  /** Apply a pure transform, seal, PUT — retrying once against a fresh config on
   *  a 409 (the other device may have booked something meanwhile). Every save
   *  prunes the grace week behind it, so the past leaves without a chore. */
  async function saveConfig(
    apply: (base: AgendaConfig) => AgendaConfig,
  ): Promise<boolean> {
    if (!cfg) return false;
    const next = (base: AgendaConfig) =>
      pruneEvents(apply(base), pruneCutoff(today));
    setBusy(true);
    setNotice(null);
    try {
      let base = cfg;
      // The cap is client-side law — refuse with a reason rather than let the
      // route answer an opaque 404 on an oversized frame.
      if (!fitsAgendaCap(next(base))) {
        setNotice("agenda is full — the envelope cap is reached");
        return false;
      }
      let result = await putConfig(next(base), configExisted);
      if (result === "conflict") {
        base = await fetchConfigFresh();
        result = await putConfig(next(base), true);
      }
      if (result !== "ok") {
        setNotice("could not save — try again");
        return false;
      }
      setCfg(next(base));
      setConfigExisted(true);
      return true;
    } catch {
      setNotice("could not save — try again");
      return false;
    } finally {
      setBusy(false);
    }
  }

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
    // The event is built ONCE, outside the transform: `addEvent` is idempotent on
    // its id, and a fresh id per re-run would defeat that on the 409 retry.
    const event: AgendaEvent = {
      id: randomId(),
      date: day,
      ...(start !== null ? { start } : {}),
      ...(start !== null && end !== null ? { end } : {}),
      title: title.trim(),
    };
    const ok = await saveConfig((base) => addEvent(base, event));
    // The composer stays open — a roster drops several days at once — but resets
    // to today so the next one can't inherit the last one's date by accident.
    if (ok) {
      setTitle("");
      setStartText("");
      setEndText("");
      setDay(today);
    }
  }

  /** `+1` — the same thing on another day: the composer opens carrying the
   *  event's text and times, and nothing is saved until `add`. */
  function repeat(event: AgendaEvent) {
    setTitle(event.title);
    setStartText(event.start ?? "");
    setEndText(event.end ?? "");
    setDay(today);
    setOpen(true);
    setNotice(null);
  }

  // --- render ---

  if (!cfg) {
    return (
      <span className="text-xs text-muted">
        {dataErr === "unreachable" ? (
          <span className="text-down">vault unreachable — reload to retry</span>
        ) : dataErr === "tamper" ? (
          <span className="text-down">cannot decrypt — lock and unlock</span>
        ) : unlocked ? (
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

        {hiddenCount > 0 && (
          <p className="pt-0.5 text-[11px] text-muted/60">
            +{hiddenCount} more within 14d
          </p>
        )}

        {open && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 text-xs">
            <select
              value={day}
              disabled={busy}
              onChange={(e) => setDay(e.target.value)}
              className={input}
              aria-label="day"
            >
              {dayOptions.map((d) => (
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
