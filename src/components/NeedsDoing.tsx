"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useVault } from "@/app/files/useVault";
import { TodoGlance } from "@/components/TodoGlance";
import { useCsvChore } from "@/components/useCsvChore";
import { GYM_CONTEXT } from "@/lib/aevcontext";
import { CHORE_CADENCE_DAYS, choreState, type ChoreState } from "@/lib/chores";
import {
  EMPTY_GYM_CONFIG,
  lastSessionDate,
  normalizeGymConfig,
  sessionsThisWeek,
  type GymConfig,
} from "@/lib/gym";
import { isVaultIndex, VAULT_INDEX_PATH } from "@/lib/vaultblob";

/**
 * NeedsDoing — the day's one board (roadmap 72), in three bands: the typed
 * captures, the life cadences, then the hub's own upkeep with the command to
 * run. It replaces the capture block AND the exception-only chores row, and it
 * is deliberately the one place ADR 0109's silent-when-fine rule doesn't hold —
 * a surface you consult has to exist to be consulted, and a cadence that only
 * appears once it's late can't be paced against.
 *
 * Every cadence is DERIVED from evidence, never self-reported: a note titled
 * with today's date, a session in the gym envelope, an import date in the fin
 * envelope, R2 modified-times for the sync and the seal. Nothing is tappable
 * but the todos — there is no checkbox here to lie to.
 *
 * The three life cadences read sealed stores, so they show sealed dots until
 * the vault key is in hand and drop their readings the moment it locks; the
 * three maintenance ones ride in as props and stay legible even locked. Every
 * read is failure-quiet — a miss reads as "no record", never as an error on the
 * homepage.
 */

/** The week's training target the session count reads against. */
const GYM_TARGET = 4;

export function NeedsDoing({
  offline,
  today,
  vaultSync,
  backup,
  aperture,
}: {
  offline: boolean;
  today: string;
  vaultSync: ChoreState;
  backup: ChoreState;
  aperture: ChoreState;
}) {
  const { status, openItem } = useVault(offline);
  const unlocked = status === "unlocked";
  const csv = useCsvChore(offline);
  /** null → unresolved: locked, still decrypting, or a read that didn't land. */
  const [journalToday, setJournalToday] = useState<boolean | null>(null);
  const [gym, setGym] = useState<GymConfig | null>(null);

  // Render-phase reset on the lock/unlock edge (the glance idiom): the decrypted
  // readings leave with the key.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setJournalToday(null);
    setGym(null);
  }

  // The daily note is titled with the Sydney date, so its presence in the sealed
  // index IS the journal cadence — no note body is ever fetched for this.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/vault/raw?p=${encodeURIComponent(VAULT_INDEX_PATH)}`,
        );
        if (!res.ok) throw new Error(`vault raw: ${res.status}`);
        const { bytes } = await openItem(
          new Uint8Array(await res.arrayBuffer()),
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!isVaultIndex(parsed)) throw new Error("vault index: bad shape");
        if (!cancelled)
          setJournalToday(parsed.notes.some((n) => n.title === today));
      } catch {
        // any miss → sealed dots rather than a day claimed missed
        if (!cancelled) setJournalToday(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem, today]);

  // The training log, read-only. A 404 is an empty log (first run); anything
  // else — unreachable, tampered, a shape this build doesn't know — reads as no
  // record. /gym owns the honest error states, a cadence row doesn't.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/gym");
        if (res.status === 404) {
          if (!cancelled) setGym(EMPTY_GYM_CONFIG);
          return;
        }
        if (res.status !== 200) throw new Error(`gym: ${res.status}`);
        const { bytes } = await openItem(
          new Uint8Array(await res.arrayBuffer()),
          GYM_CONTEXT,
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const cfg = normalizeGymConfig(parsed);
        if (!cfg) throw new Error("gym: bad shape");
        if (!cancelled) setGym(cfg);
      } catch {
        if (!cancelled) setGym(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  return (
    <div className="flex flex-col">
      <TodoGlance offline={offline} />

      <div className="mt-3 flex flex-col border-t border-hairline pt-2">
        <Row name="journal">
          {journalToday === null ? (
            <Sealed />
          ) : journalToday ? (
            <span className="text-muted">
              <span className="text-up">✓</span> today
            </span>
          ) : (
            <span className="text-amber">not yet today</span>
          )}
        </Row>
        <Row name="gym">
          {unlocked ? (
            <GymStatus
              state={choreState(
                gym ? lastSessionDate(gym) : null,
                CHORE_CADENCE_DAYS.gym,
                new Date(),
              )}
              thisWeek={gym ? sessionsThisWeek(gym, today) : 0}
            />
          ) : (
            <Sealed />
          )}
        </Row>
        <Row name="finance">
          {unlocked ? (
            <ChoreStatus
              state={csv}
              prefix="csv"
              command="export → /portfolio"
            />
          ) : (
            <Sealed />
          )}
        </Row>
      </div>

      <div className="mt-2 flex flex-col border-t border-hairline pt-2">
        <Row name="vault-sync">
          <ChoreStatus state={vaultSync} command="npm run vault-sync" />
        </Row>
        <Row name="backup">
          <ChoreStatus state={backup} command="npm run hub-backup" />
        </Row>
        <Row name="aperture">
          <ChoreStatus
            state={aperture}
            prefix="seal"
            note="check-in due"
            command="npm run aperture-sync"
          />
        </Row>
      </div>
    </div>
  );
}

/** One cadence line: what it is, and the state its own evidence puts it in. */
function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1 text-sm">
      <span className="text-fg/90">{name}</span>
      <span className="ml-auto text-right text-xs tabular-nums">
        {children}
      </span>
    </div>
  );
}

/** A verdict that needs the key: the row is there, its reading isn't. */
function Sealed() {
  return <span className="text-muted/40">···</span>;
}

/**
 * An evidence-aged line: the age, then either the tick or — only once it has
 * gone due — the literal thing to run, dimmer than the verdict carrying it. A
 * quiet line has nothing to run, so it says nothing. `prefix` names the evidence
 * where an age alone would be ambiguous ("csv 2d", "seal 2d").
 */
function ChoreStatus({
  state,
  prefix,
  note,
  command,
}: {
  state: ChoreState;
  prefix?: string;
  note?: string;
  command: string;
}) {
  if (state.status === "unknown")
    return <span className="text-muted/50">no record</span>;
  const age = `${prefix ? `${prefix} ` : ""}${state.ageDays}d`;
  if (state.status === "ok")
    return (
      <span className="text-muted">
        {age} <span className="text-up">✓</span>
      </span>
    );
  return (
    <span className={state.status === "due" ? "text-amber" : "text-down"}>
      {age} · {note && `${note} · `}
      <span className="opacity-60">{command}</span>
    </span>
  );
}

/** The training cadence: the week's sessions, coloured by how long it has been
 *  since the last one — a light week only matters once nothing is happening. */
function GymStatus({
  state,
  thisWeek,
}: {
  state: ChoreState;
  thisWeek: number;
}) {
  if (state.status === "unknown")
    return <span className="text-muted/50">no record</span>;
  const count = `${thisWeek}/${GYM_TARGET} wk`;
  if (state.status === "ok")
    return (
      <span className="text-muted">
        {count} <span className="text-up">✓</span>
      </span>
    );
  return (
    <span className={state.status === "due" ? "text-amber" : "text-down"}>
      {count} · {state.ageDays}d since
    </span>
  );
}
