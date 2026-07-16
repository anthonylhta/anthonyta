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

type Verdict =
  | { kind: "pending" }
  | { kind: "unreadable" }
  | { kind: "broken"; atSeq: number }
  | { kind: "rolled-back" | "rewritten" }
  | { kind: "verified"; log: AuthLog };

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
      if (!cancelled) setVerdict({ kind: "verified", log });
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

  const { log } = verdict;
  const recent = log.entries.slice(-8).reverse();
  return (
    <div className="text-xs">
      <p className="text-muted">
        journal: <span className="text-up">verified</span> ·{" "}
        {log.foldedThrough + log.entries.length} entries
        {log.foldedThrough > 0 ? ` (${log.foldedThrough} folded)` : ""}
      </p>
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
