"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Module } from "@/components/terminal/Module";
import { useVault } from "@/app/files/useVault";
import { isVaultIndex, noteBlob, VAULT_INDEX_PATH } from "@/lib/vaultblob";
import { parseDaily, type TodayDigest } from "@/lib/today";

/**
 * VaultTodayGlance — the command center's TODAY daily-note digest as a client island.
 * Under E2EE the vault lives sealed in the private blob store, so the server can't
 * read it: the index and today's note are fetched + decrypted here, only while the
 * vault is unlocked (the IndexedDB key cache usually means it already is). Any miss —
 * offline, locked, no note yet, a fetch/decrypt hiccup — degrades to the same Module
 * chrome with a muted nudge, so the layout never shifts and the homepage never crashes.
 * Mirrors NetWorthGlance's invested-only fallback; parseDaily stays the pure server
 * transform, now run on the decrypted bytes.
 */

interface Found {
  digest: TodayDigest;
  noteId: string;
}
/** null → not resolved (not unlocked / loading / error); "none" → unlocked but no note
 *  titled `date`; Found → unlocked and decrypted. */
type Loaded = Found | "none" | null;

/** Fetch one sealed vault blob's ciphertext through the same-origin owner-gated proxy. */
async function fetchRaw(p: string): Promise<Uint8Array> {
  const res = await fetch(`/api/vault/raw?p=${encodeURIComponent(p)}`);
  if (!res.ok) throw new Error(`vault raw ${p}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function VaultTodayGlance({
  offline,
  date,
}: {
  offline: boolean;
  date: string;
}) {
  const { status, openItem } = useVault(offline);
  const [loaded, setLoaded] = useState<Loaded>(null);

  // Render-phase reset (not an effect): drop the decrypted note the moment the vault
  // stops being unlocked, per the lint-blessed reset pattern (NetWorthGlance/FinPanel).
  const unlocked = status === "unlocked";
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    if (!unlocked) setLoaded(null);
  }

  useEffect(() => {
    if (status !== "unlocked") return;
    let cancelled = false;
    (async () => {
      try {
        const { bytes: idx } = await openItem(await fetchRaw(VAULT_INDEX_PATH));
        const parsed: unknown = JSON.parse(new TextDecoder().decode(idx));
        if (!isVaultIndex(parsed)) throw new Error("vault index: bad shape");
        const note = parsed.notes.find((n) => n.title === date);
        if (!note) {
          if (!cancelled) setLoaded("none");
          return;
        }
        const { bytes } = await openItem(await fetchRaw(noteBlob(note.id)));
        const digest = parseDaily(new TextDecoder().decode(bytes));
        if (!cancelled) setLoaded({ digest, noteId: note.id });
      } catch {
        // any fetch/decrypt failure → the unlock-nudge fallback, never a crash
        if (!cancelled) setLoaded(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, openItem, date]);

  const found = unlocked && loaded && loaded !== "none" ? loaded : null;

  return (
    <Module
      label="daily note"
      className="border-0 border-b border-hairline"
      action={
        found ? (
          <Link
            href={`/vault/${found.noteId}`}
            className="text-xs text-amber hover:underline"
          >
            read full day →
          </Link>
        ) : (
          <Link href="/vault" className="text-xs text-amber hover:underline">
            vault →
          </Link>
        )
      }
    >
      {found ? (
        <DigestView digest={found.digest} />
      ) : unlocked && loaded === "none" ? (
        <p className="text-muted">
          no note for <span className="tabular-nums">{date}</span> yet — plan it
          in the vault
        </p>
      ) : (
        <p className="text-muted">
          unlock in{" "}
          <Link href="/files" className="text-amber hover:underline">
            files/
          </Link>{" "}
          to see today&apos;s note
        </p>
      )}
    </Module>
  );
}

/** Today's daily note parsed into a headline, the day planner (checkbox state +
 *  times), and a muted journal peek — the markup the old server <DailyDigest>
 *  produced when a note existed. Read-only; checking off happens in Obsidian. */
function DigestView({ digest }: { digest: TodayDigest }) {
  return (
    <>
      {digest.summary && (
        <p className="text-fg">
          <span className="text-amber">→</span> {digest.summary}
        </p>
      )}

      {digest.planner.length > 0 ? (
        <div className={digest.summary ? "mt-3" : ""}>
          <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-muted">
            <span>day planner</span>
            <span className="tabular-nums">
              <span className="text-amber">{digest.doneCount}</span> done ·{" "}
              {digest.openCount} left
            </span>
          </div>
          <ul className="space-y-1">
            {digest.planner.map((item, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm">
                <span
                  className={item.done ? "text-up" : "text-muted"}
                  aria-hidden
                >
                  {item.done ? "✓" : "○"}
                </span>
                {item.time && (
                  <span className="shrink-0 tabular-nums text-muted">
                    {item.time}
                  </span>
                )}
                <span
                  className={item.done ? "text-muted line-through" : "text-fg"}
                >
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted">no plans logged yet</p>
      )}

      {digest.journalPreview && (
        <p className="mt-3 line-clamp-2 border-t border-hairline/40 pt-2 text-xs text-muted">
          {digest.journalPreview}
        </p>
      )}
    </>
  );
}
