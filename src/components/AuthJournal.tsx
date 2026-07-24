"use client";

import { useEffect, useState } from "react";
import {
  compareTip,
  isAuthLog,
  tipOf,
  verifyChain,
  type AuthEntry,
  type AuthLog,
} from "@/lib/authlog";
import { bumpSeenAuthTip, getSeenAuthTip } from "@/lib/keycache";
import {
  anchorHash,
  anchorVerdict,
  KEYSTORE_KINDS,
  newestEventOf,
  PRF_KINDS,
  type AnchorVerdict,
} from "@/lib/stateanchor";

/**
 * The auth-journal panel (ADR: auth journal) — /system's "journal" band. The
 * server hands over the RAW log; every judgement happens here, in the browser,
 * because the chain's whole point is tamper evidence AGAINST the server that
 * writes it — a server-side "verified" would be the author vouching for itself.
 * The device remembers the newest (seq, h) tip it verified (IDB, survives lock,
 * like the vault-manifest epoch): a served chain that's shorter is a rollback,
 * one whose remembered seq hashes differently was rewritten — both are alarms
 * with the finding named, never a silent nothing.
 */

/** One record's anchor check (58b): the journal's newest write-event of a kind
 *  attests the record's content hash; the served record must match it.
 *  `missing` = the record 404s while the journal says it was written — deleted
 *  out from under its own history. `unchecked` = the record couldn't be
 *  fetched right now (honest gray, never a pass and never an alarm). */
type AnchorCheck = {
  label: string;
  verdict: AnchorVerdict | "missing" | "unchecked";
};

type Verdict =
  | { kind: "pending" }
  | { kind: "unreadable" }
  | { kind: "broken"; atSeq: number }
  | { kind: "rolled-back" | "rewritten" }
  | { kind: "verified"; log: AuthLog; anchors: AnchorCheck[] };

export function AuthJournalPanel({
  raw,
  state,
}: {
  raw: string | null;
  state: "ok" | "absent" | "error";
}) {
  const [verdict, setVerdict] = useState<Verdict>({ kind: "pending" });

  useEffect(() => {
    if (state !== "ok" || raw === null) return;
    let cancelled = false;
    (async () => {
      let log: AuthLog;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isAuthLog(parsed)) throw new Error("bad shape");
        log = parsed;
      } catch {
        if (!cancelled) setVerdict({ kind: "unreadable" });
        return;
      }
      const chain = await verifyChain(log);
      if (!chain.ok) {
        if (!cancelled) setVerdict({ kind: "broken", atSeq: chain.atSeq });
        return;
      }
      const memory = compareTip(await getSeenAuthTip(), log);
      if (memory !== "ok") {
        if (!cancelled) setVerdict({ kind: memory });
        return;
      }
      const tip = tipOf(log);
      if (tip) await bumpSeenAuthTip(tip);

      // Anchor checks (58b) — only over a chain that just verified: hash the
      // served record, compare to the newest journal event of its kind. Runs
      // in the browser for the same reason the chain does — the server
      // vouching for its own state would be circular.
      const anchors: AnchorCheck[] = [];
      const check = async (
        label: string,
        route: string,
        kinds: typeof KEYSTORE_KINDS,
      ) => {
        const event = newestEventOf(log.entries, kinds);
        try {
          const res = await fetch(route);
          if (res.ok)
            anchors.push({
              label,
              verdict: anchorVerdict(await anchorHash(await res.text()), event),
            });
          else if (res.status === 404) {
            // No record + no write-event = nothing exists, nothing claimed.
            if (event !== null) anchors.push({ label, verdict: "missing" });
          } else anchors.push({ label, verdict: "unchecked" });
        } catch {
          anchors.push({ label, verdict: "unchecked" });
        }
      };
      await check("keystore", "/api/files/keystore", KEYSTORE_KINDS);
      await check("vault-unlock wraps", "/api/prf/wrap", PRF_KINDS);

      if (!cancelled) setVerdict({ kind: "verified", log, anchors });
    })();
    return () => {
      cancelled = true;
    };
  }, [raw, state]);

  if (state === "absent")
    return (
      <p className="text-xs text-muted">
        no journal yet — it starts recording at the next sign-in, enrollment, or
        keystore write.
      </p>
    );
  if (state === "error")
    return <p className="text-xs text-down">journal store unreachable</p>;
  if (verdict.kind === "pending")
    return <p className="text-xs text-muted">verifying the chain…</p>;

  if (verdict.kind !== "verified") {
    const finding =
      verdict.kind === "unreadable"
        ? "the journal cannot be parsed — the stored record is not a valid chain"
        : verdict.kind === "broken"
          ? `the hash chain breaks at entry ${verdict.atSeq} — history was edited in place`
          : verdict.kind === "rolled-back"
            ? "the served journal is SHORTER than what this device has verified — entries were removed from the end"
            : "the remembered tip hashes differently in the served chain — history was rewritten and re-hashed";
    return (
      <div className="border border-down/60 px-3 py-2 text-xs text-down">
        <p className="font-semibold uppercase tracking-[0.15em]">
          journal alarm
        </p>
        <p className="mt-1">{finding}</p>
        <p className="mt-1 text-down/80">
          nothing was repaired — the store holds the evidence as served
        </p>
      </div>
    );
  }

  const { log, anchors } = verdict;
  const alarms = anchors.filter(
    (a) => a.verdict === "mismatch" || a.verdict === "missing",
  );
  const recent = log.entries.slice(-8).reverse();
  return (
    <div className="text-xs">
      <p className="text-muted">
        journal: <span className="text-up">verified</span> ·{" "}
        {log.foldedThrough + log.entries.length} entries
        {log.foldedThrough > 0 ? ` (${log.foldedThrough} folded)` : ""}
      </p>
      {alarms.length > 0 && (
        <div className="mt-2 border border-down/60 px-3 py-2 text-down">
          <p className="font-semibold uppercase tracking-[0.15em]">
            state anchor alarm
          </p>
          {alarms.map((a) => (
            <p key={a.label} className="mt-1">
              {a.verdict === "mismatch"
                ? `the served ${a.label} record does not match the journal's newest write — stale or substituted state is being served`
                : `the ${a.label} record is MISSING while the journal records writing it`}
            </p>
          ))}
          <p className="mt-1 text-down/80">
            nothing was repaired — verify from a second device before trusting
            this one
          </p>
        </div>
      )}
      {anchors.length > 0 && alarms.length === 0 && (
        <p className="mt-1 text-muted/80">
          anchors:{" "}
          {anchors.map((a, i) => (
            <span key={a.label}>
              {i > 0 && " · "}
              {a.label}{" "}
              {a.verdict === "verified" ? (
                <span className="text-up">✓</span>
              ) : a.verdict === "unanchored" ? (
                <span className="text-amber/80">
                  unanchored (heals at its next write)
                </span>
              ) : (
                <span className="text-muted/60">unchecked</span>
              )}
            </span>
          ))}
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {recent.map((e) => (
          <JournalRow key={e.seq} entry={e} />
        ))}
      </ul>
    </div>
  );
}

/** One event line: when · what · which credential/detail. */
function JournalRow({ entry }: { entry: AuthEntry }) {
  return (
    <li className="flex gap-3 tabular-nums">
      <span className="shrink-0 text-muted/70">
        {entry.ts.slice(0, 16).replace("T", " ")}
      </span>
      <span className="w-20 shrink-0 text-amber">{entry.kind}</span>
      <span className="min-w-0 flex-1 truncate text-muted">{entry.detail}</span>
    </li>
  );
}
