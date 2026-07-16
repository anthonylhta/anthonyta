"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { randomId } from "@/lib/crypto";
import {
  EMPTY_TRANSIT_CONFIG,
  anchorFromParts,
  delayMinutes,
  endpointParam,
  fmtSydneyTime,
  groupNames,
  isValidHm,
  modeName,
  nextDays,
  normalizeTransitConfig,
  pickJourneys,
  removeTrip,
  tripTitle,
  upsertTrip,
  type DepArr,
  type ModeFilter,
  type PlaceCandidate,
  type TransitConfig,
  type TransitJourney,
  type TransitLeg,
  type TransitPlace,
  type TransitTrip,
  type TripResult,
} from "@/lib/transit";
import { useVault, type Vault } from "@/app/files/useVault";

// Shared input/button idioms (FinPanel / FilesInbox).
const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

const UNREACHABLE =
  "vault unreachable — reload to retry (your key is untouched)";
const TAMPER = "cannot decrypt — lock and unlock";

const MODE_OPTIONS: ModeFilter[] = ["train+bus", "train", "bus", "all"];

type JourneysState =
  | { phase: "idle" }
  | { phase: "loading"; title: string }
  | { phase: "ready"; title: string; sample: boolean; result: TripResult }
  | { phase: "error"; msg: string };

/**
 * The /transit island: a Google-Maps-style door-to-door planner over the
 * owner-gated TfNSW proxy, plus saved trips in groups. The trips (real
 * home/work addresses) live sealed in the E2EE transit envelope — they load
 * and decrypt here only while the vault is unlocked, and journey queries send
 * an endpoint pair per request, which the server relays without storing. The
 * one-off planner deliberately works even locked: it holds nothing private.
 */
export function TransitClient({ offline }: { offline: boolean }) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  // Decrypted saved-trips config (unlocked only).
  const [cfg, setCfg] = useState<TransitConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [cfgErr, setCfgErr] = useState<"unreachable" | "tamper" | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  // Planner endpoints + journeys.
  const [from, setFrom] = useState<TransitPlace | null>(null);
  const [to, setTo] = useState<TransitPlace | null>(null);
  const [modes, setModes] = useState<ModeFilter>("train+bus");
  // "now" = plan forward from the present; "dep"/"arr" anchor on a day pick +
  // typed HH:MM (themed parts — native datetime pickers fight the terminal
  // look). The device clock is the owner's clock.
  const [timing, setTiming] = useState<"now" | "dep" | "arr">("now");
  // Recomputed per render (7 tiny objects) so "today" stays true even in a
  // tab that lives past midnight.
  const dayOptions = nextDays(7);
  const [dayYmd, setDayYmd] = useState(() => nextDays(1)[0].ymd);
  const [timeText, setTimeText] = useState("");
  const [js, setJs] = useState<JourneysState>({ phase: "idle" });
  // Collapsed by default: pickJourneys picks ≤ 2 worth choosing between.
  const [showAll, setShowAll] = useState(false);
  const runSeq = useRef(0);

  // Render-phase reset on the lock/unlock edge (FinPanel's idiom) — decrypted
  // trips AND any journeys derived from them leave with the key.
  const [prevUnlocked, setPrevUnlocked] = useState(unlocked);
  if (prevUnlocked !== unlocked) {
    setPrevUnlocked(unlocked);
    setCfg(null);
    setCfgErr(null);
    setJs({ phase: "idle" });
  }

  /** Plan one origin→destination; a later call abandons an earlier response. */
  const plan = useCallback(
    async (
      f: TransitPlace,
      t: TransitPlace,
      m: ModeFilter,
      title: string,
      when: { depArr: DepArr; at: Date } | null = null,
    ) => {
      const seq = ++runSeq.current;
      setShowAll(false);
      setJs({ phase: "loading", title });
      try {
        const qs = new URLSearchParams([
          ["from", endpointParam(f)],
          ["to", endpointParam(t)],
          ["modes", m],
        ]);
        if (when) {
          qs.set("when", when.depArr);
          qs.set("at", when.at.toISOString());
        }
        const res = await fetch(`/api/transit/trip?${qs}`);
        if (runSeq.current !== seq) return;
        if (!res.ok) {
          setJs({
            phase: "error",
            msg:
              res.status === 503
                ? "trip planner unreachable — try again"
                : "trip request failed",
          });
          return;
        }
        const data = (await res.json()) as {
          sample?: boolean;
          result?: TripResult;
        };
        if (runSeq.current !== seq) return;
        if (!data.result || !Array.isArray(data.result.journeys)) {
          setJs({ phase: "error", msg: "trip request failed" });
          return;
        }
        setJs({
          phase: "ready",
          title,
          sample: data.sample === true,
          result: data.result,
        });
      } catch {
        if (runSeq.current === seq)
          setJs({ phase: "error", msg: "trip request failed" });
      }
    },
    [],
  );

  /** The planner's current time anchor (null = leave now); annotates the
   *  journeys title so a constrained plan names its constraint. */
  function currentTiming(): {
    when: { depArr: DepArr; at: Date } | null;
    suffix: string;
  } {
    if (timing === "now") return { when: null, suffix: "" };
    const at = anchorFromParts(dayYmd, timeText);
    if (!at) return { when: null, suffix: "" };
    const day = dayOptions.find((d) => d.ymd === dayYmd)?.label ?? dayYmd;
    const wall = `${day} ${timeText}`;
    return {
      when: { depArr: timing, at },
      suffix: timing === "arr" ? ` · arrive by ${wall}` : ` · leave ${wall}`,
    };
  }

  function runTrip(trip: TransitTrip, flip = false) {
    const f = flip ? trip.to : trip.from;
    const t = flip ? trip.from : trip.to;
    const title = flip
      ? `${trip.to.name} → ${trip.from.name}`
      : tripTitle(trip);
    const { when, suffix } = currentTiming();
    void plan(f, t, trip.modes, title + suffix, when);
  }

  // Load + decrypt once per unlock; auto-plan the first saved trip so opening
  // the page IS checking the commute. Mirrors FinPanel's three-way read: a
  // healthy 404 is first-run, anything else must never look like it.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    (async () => {
      let config: TransitConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/transit/config");
        if (res.status === 404) {
          config = EMPTY_TRANSIT_CONFIG;
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeTransitConfig(parsed);
            if (!config) throw new Error("bad shape");
            existed = true;
          } catch {
            if (!cancelled) setCfgErr("tamper");
            return;
          }
        } else {
          if (!cancelled) setCfgErr("unreachable");
          return;
        }
      } catch {
        if (!cancelled) setCfgErr("unreachable");
        return;
      }

      if (cancelled) return;
      setCfg(config);
      setConfigExisted(existed);
      const first = config.trips[0];
      if (first) void plan(first.from, first.to, first.modes, tripTitle(first));
    })();

    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem, plan]);

  // --- config persistence (seal → PUT, retry once on a 409) ---

  async function putConfig(
    next: TransitConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "transit.json", t: "application/json", s: bytes.length },
      bytes,
    );
    const res = await fetch("/api/transit/config", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-transit-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<TransitConfig> {
    const res = await fetch("/api/transit/config");
    if (res.status === 404) return EMPTY_TRANSIT_CONFIG;
    if (res.status !== 200) throw new Error("config refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeTransitConfig(parsed);
    if (!config) throw new Error("config refetch: bad shape");
    return config;
  }

  async function saveConfig(
    apply: (base: TransitConfig) => TransitConfig,
  ): Promise<boolean> {
    if (!cfg) return false;
    try {
      let base = cfg;
      let result = await putConfig(apply(base), configExisted);
      if (result === "conflict") {
        base = await fetchConfigFresh();
        result = await putConfig(apply(base), true);
      }
      if (result !== "ok") return false;
      setCfg(apply(base));
      setConfigExisted(true);
      return true;
    } catch {
      return false;
    }
  }

  async function saveTrip(group: string, label: string): Promise<boolean> {
    if (!from || !to) return false;
    const trip: TransitTrip = {
      id: randomId(),
      group,
      label,
      from,
      to,
      modes,
    };
    const ok = await saveConfig((base) => upsertTrip(base, trip));
    if (ok) setActiveGroup(group);
    return ok;
  }

  async function deleteTrip(trip: TransitTrip): Promise<void> {
    await saveConfig((base) => removeTrip(base, trip.id));
  }

  // --- render ---

  const groups = cfg ? groupNames(cfg) : [];
  const shownGroup =
    activeGroup && groups.includes(activeGroup)
      ? activeGroup
      : (groups[0] ?? null);
  const shownTrips = cfg
    ? cfg.trips.filter((t) => (t.group || null) === shownGroup)
    : [];
  const planning = js.phase === "loading";

  return (
    <div className="flex flex-col text-sm">
      {/* one-off planner — works even locked; holds nothing private */}
      <div className="border-b border-hairline px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <PlaceField label="from" value={from} onChange={setFrom} />
          <button
            type="button"
            title="swap"
            aria-label="swap origin and destination"
            className={`${btn} self-start sm:mt-5`}
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            ⇄
          </button>
          <PlaceField label="to" value={to} onChange={setTo} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={timing}
            onChange={(e) => setTiming(e.target.value as typeof timing)}
            className={input}
            aria-label="departure or arrival anchor"
          >
            <option value="now">leave now</option>
            <option value="dep">leave at</option>
            <option value="arr">arrive by</option>
          </select>
          {timing !== "now" && (
            <>
              <select
                value={dayYmd}
                onChange={(e) => setDayYmd(e.target.value)}
                className={input}
                aria-label="day"
              >
                {dayOptions.map((d) => (
                  <option key={d.ymd} value={d.ymd}>
                    {d.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                value={timeText}
                onChange={(e) => setTimeText(e.target.value)}
                placeholder="hh:mm"
                className={`w-20 ${input} ${
                  timeText && !isValidHm(timeText) ? "text-down" : ""
                }`}
                aria-label="time (24h hh:mm)"
              />
            </>
          )}
          <select
            value={modes}
            onChange={(e) => setModes(e.target.value as ModeFilter)}
            className={input}
            aria-label="transport modes"
          >
            {MODE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={btn}
            disabled={!from || !to || planning}
            onClick={() => {
              if (!from || !to) return;
              const { when, suffix } = currentTiming();
              void plan(
                from,
                to,
                modes,
                `${from.name} → ${to.name}${suffix}`,
                when,
              );
            }}
          >
            plan ▸
          </button>
          {js.phase !== "idle" && (
            <button
              type="button"
              className={btn}
              title="clear results"
              onClick={() => {
                runSeq.current++;
                setJs({ phase: "idle" });
              }}
            >
              clear
            </button>
          )}
          {unlocked && cfg && from && to && (
            <SaveTripForm groups={groups} onSave={saveTrip} />
          )}
        </div>
      </div>

      {/* journeys */}
      {js.phase === "loading" && (
        <p className="border-b border-hairline px-4 py-3 text-xs text-muted">
          planning {js.title}…
        </p>
      )}
      {js.phase === "error" && (
        <p className="border-b border-hairline px-4 py-3 text-xs text-down">
          {js.msg}
        </p>
      )}
      {js.phase === "ready" && (
        <div className="border-b border-hairline px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-2 pb-2">
            <span className="min-w-0 truncate text-xs text-muted">
              {js.title}
            </span>
            {js.sample && (
              <span className="border border-hairline px-1.5 py-0.5 text-[10px] text-muted">
                sample data — set TNSW_API_KEY
              </span>
            )}
          </div>
          {js.result.alerts.length > 0 && (
            <div className="mb-2 border border-hairline border-l-amber bg-surface/40 px-3 py-2">
              {js.result.alerts.map((a) => (
                <p key={a.id} className="text-xs text-amber/90">
                  ⚠ {a.title}
                  {a.url && (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 text-muted underline hover:text-amber"
                    >
                      details
                    </a>
                  )}
                </p>
              ))}
            </div>
          )}
          {js.result.journeys.length === 0 ? (
            <p className="text-xs text-muted">no journeys found</p>
          ) : (
            (() => {
              const shown = showAll
                ? js.result.journeys
                : pickJourneys(js.result.journeys);
              const hidden = js.result.journeys.length - shown.length;
              return (
                <div className="flex flex-col gap-2">
                  {shown.map((j, i) => (
                    <JourneyCard key={i} journey={j} fastest={i === 0} />
                  ))}
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAll(true)}
                      className="self-start text-xs text-muted transition-colors hover:text-amber"
                    >
                      + {hidden} more option{hidden === 1 ? "" : "s"} ▸
                    </button>
                  )}
                  {showAll && js.result.journeys.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setShowAll(false)}
                      className="self-start text-xs text-muted transition-colors hover:text-amber"
                    >
                      ▴ show fewer
                    </button>
                  )}
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* saved trips — the E2EE side */}
      <div className="px-4 py-3">
        <p className="pb-2 text-[11px] uppercase tracking-[0.2em] text-muted">
          saved trips
        </p>

        {vault.status === "offline" && (
          <p className="text-xs text-muted">
            store offline — set the R2_* env vars
          </p>
        )}
        {vault.status === "loading" && (
          <p className="text-xs text-muted">checking vault…</p>
        )}
        {vault.status === "setup" && (
          <p className="text-xs text-muted">
            set a vault passphrase in{" "}
            <Link href="/files" className="text-amber hover:underline">
              files/
            </Link>{" "}
            first — saved trips are end-to-end encrypted
          </p>
        )}
        {vault.status === "locked" && <UnlockBox vault={vault} />}
        {vault.status === "error" && (
          <p className="text-xs text-down">{UNREACHABLE}</p>
        )}

        {unlocked && cfgErr && (
          <p className="text-xs text-down">
            {cfgErr === "unreachable" ? UNREACHABLE : TAMPER}
          </p>
        )}
        {unlocked && !cfgErr && !cfg && (
          <p className="text-xs text-muted">decrypting…</p>
        )}

        {unlocked && cfg && (
          <>
            {groups.length > 1 && (
              <div className="flex flex-wrap gap-1 pb-2">
                {groups.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setActiveGroup(g)}
                    className={
                      g === shownGroup
                        ? "border border-amber bg-amber px-2 py-0.5 text-xs font-semibold text-bg"
                        : "border border-hairline px-2 py-0.5 text-xs text-muted hover:border-amber hover:text-amber"
                    }
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
            {shownTrips.length === 0 ? (
              <p className="text-xs text-muted">
                nothing saved yet — plan a trip above, then “save trip”
              </p>
            ) : (
              <div className="flex flex-col">
                {shownTrips.map((trip) => (
                  <div
                    key={trip.id}
                    className="flex items-center gap-2 border-t border-hairline/60 py-1.5 first:border-t-0"
                  >
                    <button
                      type="button"
                      onClick={() => runTrip(trip)}
                      title="plan this trip"
                      className="min-w-0 flex-1 truncate text-left text-fg transition-colors hover:text-amber"
                    >
                      {tripTitle(trip)}
                    </button>
                    <span className="text-[10px] text-muted">{trip.modes}</span>
                    <button
                      type="button"
                      title="plan the return trip"
                      onClick={() => runTrip(trip, true)}
                      className={btn}
                    >
                      ⇄
                    </button>
                    <DeleteButton onConfirm={() => void deleteTrip(trip)} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Two-tap delete, in-theme (no native confirm dialog): first tap arms the
 *  button as an amber-red "sure?", a second tap within 4s deletes. */
function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <button
        type="button"
        title="confirm delete"
        onClick={onConfirm}
        className="border border-down px-2 py-1 text-down transition-colors hover:bg-down hover:text-bg"
      >
        sure?
      </button>
    );
  }
  return (
    <button
      type="button"
      title="delete"
      onClick={() => setArmed(true)}
      className={btn}
    >
      ✕
    </button>
  );
}

/** Debounced free-text place search against the owner-gated stop finder. */
function PlaceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TransitPlace | null;
  onChange: (p: TransitPlace | null) => void;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<PlaceCandidate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onInput(v: string) {
    onChange(null);
    setText(v);
    setFailed(false);
    if (timer.current) clearTimeout(timer.current);
    const q = v.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(async () => {
      const s = ++seq.current;
      try {
        const res = await fetch(
          `/api/transit/stops?q=${encodeURIComponent(q)}`,
        );
        if (seq.current !== s) return;
        if (!res.ok) {
          setResults([]);
          setFailed(true);
          return;
        }
        const data = (await res.json()) as { places?: PlaceCandidate[] };
        setResults(Array.isArray(data.places) ? data.places : []);
      } catch {
        if (seq.current === s) {
          setResults([]);
          setFailed(true);
        }
      }
    }, 300);
  }

  function pick(p: PlaceCandidate) {
    onChange({ kind: p.kind, value: p.value, name: p.name });
    setText("");
    setResults(null);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <label className="block pb-1 text-[10px] uppercase tracking-[0.2em] text-muted">
        {label}
      </label>
      <input
        type="text"
        value={value ? value.name : text}
        onChange={(e) => onInput(e.target.value)}
        placeholder="address, stop or place"
        className={`w-full ${input}`}
      />
      {!value && results !== null && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto border border-hairline bg-bg">
          {results.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted">
              {failed ? "search unreachable" : "no matches"}
            </li>
          ) : (
            results.map((p) => (
              <li key={`${p.kind}:${p.value}`}>
                <button
                  type="button"
                  onClick={() => pick(p)}
                  className="block w-full px-2 py-1.5 text-left text-xs text-fg hover:bg-surface hover:text-amber"
                >
                  {p.name}
                  {p.sub && (
                    <span className="block text-[10px] text-muted">
                      {p.sub}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Inline "save trip" — group (existing or new) + optional label. */
function SaveTripForm({
  groups,
  onSave,
}: {
  groups: string[];
  onSave: (group: string, label: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  if (!open) {
    return (
      <button type="button" className={btn} onClick={() => setOpen(true)}>
        save trip
      </button>
    );
  }

  async function submit() {
    const g = group.trim() || "trips";
    setBusy(true);
    setErr(false);
    const ok = await onSave(g, label.trim());
    setBusy(false);
    if (!ok) {
      setErr(true);
      return;
    }
    setOpen(false);
    setGroup("");
    setLabel("");
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        placeholder="group (work…)"
        className={`w-28 ${input}`}
        disabled={busy}
      />
      {groups
        .filter((g) => g !== group.trim())
        .map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroup(g)}
            disabled={busy}
            className="border border-hairline px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:border-amber hover:text-amber"
          >
            {g}
          </button>
        ))}
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="label (optional)"
        className={`w-32 ${input}`}
        disabled={busy}
      />
      <button type="button" className={btn} onClick={submit} disabled={busy}>
        {busy ? "saving…" : "save"}
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => setOpen(false)}
        disabled={busy}
      >
        cancel
      </button>
      {err && <span className="text-xs text-down">save failed</span>}
    </span>
  );
}

/** cancelled / +N min / on time / live / scheduled — one chip per state. */
function LegChip({ leg }: { leg: TransitLeg }) {
  if (leg.cancelled)
    return <span className="text-xs text-down">✕ cancelled</span>;
  const delay = delayMinutes(leg.from.timePlanned, leg.from.timeEst);
  if (delay !== null && delay > 0)
    return <span className="text-xs text-amber">● +{delay} min</span>;
  if (delay !== null) return <span className="text-xs text-up">● on time</span>;
  if (leg.live) return <span className="text-xs text-up">● live</span>;
  return <span className="text-xs text-muted">○ scheduled</span>;
}

function LegRow({ leg }: { leg: TransitLeg }) {
  if (leg.kind === "walk") {
    return (
      <li className="py-1 text-xs text-muted">
        walk
        {leg.distanceM !== null && ` ${leg.distanceM} m`}
        {leg.durationMin !== null && ` · ${leg.durationMin} min`} →{" "}
        {leg.to.name}
      </li>
    );
  }
  return (
    <li className="border-t border-hairline/60 py-1.5 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="border border-hairline px-1.5 text-xs font-semibold text-fg">
          {leg.line ?? modeName(leg.modeClass)}
        </span>
        {leg.headsign && (
          <span className="text-xs text-muted">→ {leg.headsign}</span>
        )}
        <span className="ml-auto">
          <LegChip leg={leg} />
        </span>
      </div>
      <div className="mt-1 flex flex-col gap-0.5 text-xs">
        <LegPointRow
          time={leg.from.timeEst ?? leg.from.timePlanned}
          name={leg.from.name}
          platform={leg.from.platform}
        />
        {leg.stops.length > 0 && (
          <details className="pl-14 text-muted">
            <summary className="cursor-pointer hover:text-amber">
              {leg.stops.length} stop{leg.stops.length === 1 ? "" : "s"}
            </summary>
            <ol className="mt-1 flex flex-col gap-0.5 border-l border-hairline pl-3">
              {leg.stops.map((s, i) => (
                <li key={i} className="tabular-nums">
                  <span className="text-fg/80">{fmtSydneyTime(s.time)}</span>{" "}
                  {s.name}
                </li>
              ))}
            </ol>
          </details>
        )}
        <LegPointRow
          time={leg.to.timeEst ?? leg.to.timePlanned}
          name={leg.to.name}
          platform={leg.to.platform}
        />
      </div>
    </li>
  );
}

function LegPointRow({
  time,
  name,
  platform,
}: {
  time: string | null;
  name: string;
  platform: string | null;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-12 shrink-0 font-semibold tabular-nums text-fg">
        {fmtSydneyTime(time)}
      </span>
      <span className="min-w-0 truncate">{name}</span>
      {platform && (
        <span className="shrink-0 text-[10px] text-muted">plat {platform}</span>
      )}
    </div>
  );
}

function JourneyCard({
  journey,
  fastest,
}: {
  journey: TransitJourney;
  fastest: boolean;
}) {
  const dep = journey.departEst ?? journey.departPlanned;
  const arr = journey.arriveEst ?? journey.arrivePlanned;
  return (
    <article className="border border-hairline bg-surface/40">
      <header className="flex flex-wrap items-baseline gap-2 border-b border-hairline px-3 py-2">
        <span className="font-semibold tabular-nums text-fg">
          {fmtSydneyTime(dep)} → {fmtSydneyTime(arr)}
        </span>
        <span className="text-xs text-muted">
          {journey.durationMin !== null && `${journey.durationMin} min`}
          {` · ${journey.interchanges} change${
            journey.interchanges === 1 ? "" : "s"
          }`}
        </span>
        <span className="ml-auto flex items-baseline gap-2">
          {fastest && !journey.cancelled && (
            <span className="bg-amber px-1.5 text-[10px] font-semibold text-bg">
              first
            </span>
          )}
          {journey.cancelled ? (
            <span className="text-xs text-down">✕ service cancelled</span>
          ) : journey.delayMin !== null && journey.delayMin > 0 ? (
            <span className="text-xs text-amber">
              ● +{journey.delayMin} min
            </span>
          ) : journey.live ? (
            <span className="text-xs text-up">● live</span>
          ) : (
            <span className="text-xs text-muted">○ scheduled</span>
          )}
        </span>
      </header>
      <ol className="px-3 py-2">
        {journey.legs.map((leg, i) => (
          <LegRow key={i} leg={leg} />
        ))}
      </ol>
    </article>
  );
}

/** Locked: an inline passphrase prompt reusing the one MK (FinPanel's idiom). */
function UnlockBox({ vault }: { vault: Vault }) {
  const [pass, setPass] = useState("");

  async function submit() {
    if (!pass || vault.working) return;
    await vault.unlock(pass);
    setPass("");
  }

  return (
    <div className="text-xs">
      <p className="mb-2 text-muted">
        vault <span className="text-amber">locked</span> — enter the passphrase
        to reveal your saved trips.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={pass}
          disabled={vault.working}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="passphrase"
          className={`flex-1 ${input}`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={vault.working || !pass}
          className={btn}
        >
          {vault.working ? "deriving key…" : "unlock"}
        </button>
      </div>
      {vault.error && <p className="mt-2 text-down">{vault.error}</p>}
    </div>
  );
}
