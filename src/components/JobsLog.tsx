"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import {
  checkSeqAndRemember,
  rememberSavedSeq,
  SeqAlarm,
} from "@/components/SeqAlarm";
import { JOBS_CONTEXT } from "@/lib/aevcontext";
import { randomId } from "@/lib/crypto";
import {
  addApp,
  addEvent,
  closedCounts,
  daysSince,
  EMPTY_JOBS_CONFIG,
  EVENT_KINDS,
  FILTER_MIN,
  filterApps,
  fitsJobsCap,
  funnel,
  FUNNEL_MIN_CLOSED,
  lastEvent,
  MAX_APPS,
  normalizeJobsConfig,
  QUIET_DAYS,
  removeApp,
  sortActive,
  sortClosed,
  type JobApp,
  type JobEventKind,
  type JobsConfig,
} from "@/lib/jobs";
import { nextSeq } from "@/lib/seqrule";

/**
 * JobsLog — the application ledger as one client island (ADR 0166). A LOG, not a
 * pipeline board (variant B of the mockup — most applications never respond, so
 * a row is company · role · its last event, and the full timeline lives behind a
 * tap). Everything decrypts here off the sealed `meta/jobs` envelope; every save
 * is the fin panel's seal → PUT → retry-once-on-409 dance over a pure transform.
 *
 * Volume is designed in rather than hoped away: active rows sort as a CHASE LIST
 * (oldest last event on top, amber past QUIET_DAYS), closed rows fold behind one
 * line, a filter input appears once the ledger outgrows a screen, and the funnel
 * line appears once enough applications have closed for it to mean something.
 */

const inputCls =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btnCls =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

const KIND_LABEL: Record<JobEventKind, string> = {
  applied: "applied",
  screen: "phone screen",
  assessment: "assessment",
  tech: "tech interview",
  interview: "interview",
  offer: "offer",
  accepted: "accepted",
  rejected: "rejected",
  withdrawn: "withdrawn",
  ghosted: "ghosted",
};

/** "2026-08-28" → "aug 28" — the row register's date. */
function shortDate(day: string): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(`${day}T00:00:00Z`));
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${month.toLowerCase()} ${d}`;
}

export function JobsLog({
  offline,
  today,
}: {
  offline: boolean;
  today: string;
}) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<JobsConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [seqAlarm, setSeqAlarm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [q, setQ] = useState("");

  // Render-phase reset on the lock/unlock edge (the glance idiom): the decrypted
  // ledger leaves with the key.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setCfg(null);
    setDataErr(null);
    setNotice(null);
    setOpenId(null);
  }

  // Load + decrypt once per unlock. A healthy 404 is first-run; anything else
  // must never look like it (the keystore lesson).
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      let config: JobsConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/jobs");
        if (res.status === 404) {
          config = EMPTY_JOBS_CONFIG;
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope, JOBS_CONTEXT);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeJobsConfig(parsed);
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
      // Rollback check (58b) — a 404 for a ledger this device has seen alarms too.
      void checkSeqAndRemember("jobs", config).then((rolled) => {
        if (rolled && !cancelled) setSeqAlarm(true);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  async function putConfig(
    next: JobsConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    // Bump the sealed write counter (58b); prior = the newer of loaded state
    // and next itself (a 409-dance rebuild carries the fresher seq).
    next = { ...next, seq: Math.max(nextSeq(cfg ?? {}), nextSeq(next)) };
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "jobs.json", t: "application/json", s: bytes.length },
      bytes,
      JOBS_CONTEXT,
    );
    const res = await fetch("/api/jobs", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-jobs-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    if (res.ok) rememberSavedSeq("jobs", next);
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<JobsConfig> {
    const res = await fetch("/api/jobs");
    if (res.status === 404) return EMPTY_JOBS_CONFIG;
    if (res.status !== 200) throw new Error("jobs refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope, JOBS_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeJobsConfig(parsed);
    if (!config) throw new Error("jobs refetch: bad shape");
    return config;
  }

  /** Apply a pure transform, seal, PUT — retrying once against a fresh config on
   *  a 409 (another device may have logged something meanwhile). */
  async function saveConfig(
    apply: (base: JobsConfig) => JobsConfig,
  ): Promise<boolean> {
    if (!cfg) return false;
    setBusy(true);
    setNotice(null);
    try {
      let base = cfg;
      if (!fitsJobsCap(apply(base))) {
        setNotice("ledger is full — the envelope cap is reached");
        return false;
      }
      let result = await putConfig(apply(base), configExisted);
      if (result === "conflict") {
        base = await fetchConfigFresh();
        result = await putConfig(apply(base), true);
      }
      if (result !== "ok") {
        setNotice("could not save — try again");
        return false;
      }
      setCfg(apply(base));
      setConfigExisted(true);
      return true;
    } catch {
      setNotice("could not save — try again");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // --- render ---

  if (!unlocked || !cfg) {
    return (
      <div className="px-4 py-4">
        <p className="text-xs text-muted">
          {dataErr === "unreachable" ? (
            <span className="text-down">
              vault unreachable — reload to retry
            </span>
          ) : dataErr === "tamper" ? (
            <span className="text-down">cannot decrypt — lock and unlock</span>
          ) : unlocked ? (
            "decrypting…"
          ) : (
            <>
              the pipeline <span className="text-muted/40">·····</span> sealed —{" "}
              <Link href="/files" className="text-amber hover:underline">
                unlock in files →
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }

  const active = sortActive(cfg.apps);
  const closed = sortClosed(cfg.apps);
  const f = funnel(cfg.apps);
  const verdicts = closedCounts(cfg.apps);
  const verdictLine = Object.entries(verdicts)
    .map(([k, n]) => `${n} ${k}`)
    .join(" · ");
  const filtering = cfg.apps.length > FILTER_MIN;
  const shownActive = filterApps(active, q);
  const shownClosed = filterApps(closed, q);

  return (
    <div className="flex flex-col">
      {seqAlarm && (
        <div className="px-4 pt-4">
          <SeqAlarm what="application ledger" />
        </div>
      )}

      <div className="px-4 pt-4 pb-1 text-xs text-muted">
        the pipeline · <span className="text-fg">{active.length}</span> active ·{" "}
        <span className="text-fg">{closed.length}</span> closed
        {closed.length >= FUNNEL_MIN_CLOSED && (
          <span className="tabular-nums text-muted/70">
            {" — "}
            {f.applied} applied → {f.screened} screens → {f.interviewed}{" "}
            interviews → {f.offers} offers
          </span>
        )}
      </div>

      <Composer
        busy={busy}
        today={today}
        atCap={cfg.apps.length >= MAX_APPS}
        onAdd={async (app) => {
          const next = addApp(cfg, app);
          if (next === null) {
            setNotice(`ledger is full — ${MAX_APPS} applications`);
            return false;
          }
          return saveConfig((base) => addApp(base, app) ?? base);
        }}
      />

      {notice && <p className="px-4 pb-2 text-xs text-amber">{notice}</p>}

      {filtering && (
        <div className="px-4 pb-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter…"
            aria-label="filter applications"
            className={`w-full ${inputCls}`}
          />
        </div>
      )}

      {cfg.apps.length === 0 ? (
        <p className="border-t border-hairline px-4 py-4 text-xs text-muted">
          no applications logged yet — add the first above.
        </p>
      ) : (
        <>
          <p className="border-t border-hairline px-4 pt-2.5 pb-1 text-[10px] uppercase tracking-[0.12em] text-muted/60">
            active · {shownActive.length}
          </p>
          {shownActive.map((a) => (
            <AppRow
              key={a.id}
              app={a}
              today={today}
              open={openId === a.id}
              busy={busy}
              onToggle={() => setOpenId((cur) => (cur === a.id ? null : a.id))}
              saveConfig={saveConfig}
            />
          ))}
          {closed.length > 0 && (
            <button
              type="button"
              onClick={() => setShowClosed((s) => !s)}
              className="px-4 py-2.5 text-left text-xs text-muted"
            >
              closed · <span className="text-muted/70">{verdictLine}</span> —{" "}
              {showClosed ? "hide ▴" : "show ▸"}
            </button>
          )}
          {showClosed &&
            shownClosed.map((a) => (
              <div key={a.id} className="opacity-55">
                <AppRow
                  app={a}
                  today={today}
                  open={openId === a.id}
                  busy={busy}
                  onToggle={() =>
                    setOpenId((cur) => (cur === a.id ? null : a.id))
                  }
                  saveConfig={saveConfig}
                />
              </div>
            ))}
        </>
      )}
    </div>
  );
}

/** The add-an-application line — company is the only required field; the date
 *  logs the `applied` event, so a backfilled row lands on its real day. */
function Composer({
  busy,
  today,
  atCap,
  onAdd,
}: {
  busy: boolean;
  today: string;
  atCap: boolean;
  onAdd: (app: JobApp) => Promise<boolean>;
}) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [url, setUrl] = useState("");
  const [date, setDate] = useState(today);

  async function add() {
    const co = company.trim();
    if (co === "" || busy || atCap) return;
    const link = url.trim();
    const app: JobApp = {
      id: randomId(),
      company: co,
      role: role.trim(),
      ...(link !== ""
        ? { url: /^https?:\/\//.test(link) ? link : `https://${link}` }
        : {}),
      events: [{ date: date || today, kind: "applied" }],
    };
    if (await onAdd(app)) {
      setCompany("");
      setRole("");
      setUrl("");
      setDate(today);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-3">
      <input
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        placeholder="company"
        aria-label="company"
        className={`w-32 flex-1 ${inputCls}`}
      />
      <input
        value={role}
        onChange={(e) => setRole(e.target.value)}
        placeholder="role"
        aria-label="role"
        className={`w-40 flex-[1.4] ${inputCls}`}
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="link (optional)"
        aria-label="link"
        className={`w-36 flex-[1.4] ${inputCls}`}
      />
      <input
        type="date"
        value={date}
        max={today}
        onChange={(e) => setDate(e.target.value)}
        aria-label="applied date"
        className={`tabular-nums ${inputCls}`}
      />
      <button
        type="button"
        onClick={add}
        disabled={busy || atCap || company.trim() === ""}
        className={btnCls}
      >
        + add
      </button>
    </div>
  );
}

/** One row of the log (variant B): company · role — last event, age right; the
 *  full timeline and the event composer unfold on tap. */
function AppRow({
  app,
  today,
  open,
  busy,
  onToggle,
  saveConfig,
}: {
  app: JobApp;
  today: string;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  saveConfig: (apply: (base: JobsConfig) => JobsConfig) => Promise<boolean>;
}) {
  const last = lastEvent(app);
  const days = last ? daysSince(last.date, today) : null;
  const quiet = days !== null && days >= QUIET_DAYS;

  return (
    <div className="border-t border-hairline">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2 px-4 py-2.5 text-left hover:bg-fg/5"
      >
        <span className="shrink-0 text-[13px] text-fg">{app.company}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {app.role !== "" && `${app.role} — `}
          {last ? (
            <span className="text-fg/80">
              {KIND_LABEL[last.kind]} · {shortDate(last.date)}
            </span>
          ) : (
            "no events"
          )}
        </span>
        {days !== null && (
          <span
            className={`shrink-0 text-[11px] tabular-nums ${
              quiet ? "text-amber" : "text-muted"
            }`}
          >
            {quiet ? `quiet ${days}d` : days === 0 ? "today" : `${days}d ago`}
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-3">
          {app.url && (
            <a
              href={app.url}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-muted hover:text-amber"
            >
              posting <span className="text-muted/60">↗</span>
            </a>
          )}
          <div className="mt-1 border-l border-hairline pl-3">
            {app.events.map((e, i) => (
              <p key={i} className="py-0.5 text-[11px] tabular-nums text-muted">
                <span className="text-muted/60">{shortDate(e.date)}</span>{" "}
                <span className="text-fg/80">{KIND_LABEL[e.kind]}</span>
                {e.note && <span> · {e.note}</span>}
              </p>
            ))}
            <EventAdd
              busy={busy}
              today={today}
              onLog={(event) =>
                saveConfig((base) => addEvent(base, app.id, event))
              }
            />
          </div>
          <RemoveApp
            busy={busy}
            company={app.company}
            onRemove={() => saveConfig((base) => removeApp(base, app.id))}
          />
        </div>
      )}
    </div>
  );
}

/** Log the next thing that happened — including the terminal verdicts, which is
 *  how a row closes (state is only ever the event list). */
function EventAdd({
  busy,
  today,
  onLog,
}: {
  busy: boolean;
  today: string;
  onLog: (event: {
    date: string;
    kind: JobEventKind;
    note?: string;
  }) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<"" | JobEventKind>("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");

  async function log() {
    if (kind === "" || busy) return;
    const trimmed = note.trim();
    const ok = await onLog({
      date: date || today,
      kind,
      ...(trimmed !== "" ? { note: trimmed } : {}),
    });
    if (ok) {
      setKind("");
      setNote("");
      setDate(today);
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as "" | JobEventKind)}
        aria-label="event kind"
        className={`${inputCls} text-xs`}
      >
        <option value="">event…</option>
        {EVENT_KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={date}
        max={today}
        onChange={(e) => setDate(e.target.value)}
        aria-label="event date"
        className={`tabular-nums ${inputCls} text-xs`}
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="note (optional)"
        aria-label="event note"
        className={`w-36 flex-1 ${inputCls} text-xs`}
      />
      <button
        type="button"
        onClick={log}
        disabled={busy || kind === ""}
        className={`${btnCls} text-xs`}
      >
        + log
      </button>
    </div>
  );
}

/** Two-tap delete (the transit idiom) — for a mis-entry, not an outcome; a real
 *  verdict is logged as an event so the history keeps it. */
function RemoveApp({
  busy,
  company,
  onRemove,
}: {
  busy: boolean;
  company: string;
  onRemove: () => Promise<boolean>;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        void onRemove();
      }}
      onBlur={() => setArmed(false)}
      className={`mt-2 text-[11px] ${
        armed ? "text-down" : "text-muted/60 hover:text-down"
      }`}
    >
      {armed ? `remove ${company}? tap again` : "remove"}
    </button>
  );
}
