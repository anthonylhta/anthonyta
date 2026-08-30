"use client";

import { useState } from "react";
import Link from "next/link";
import { SeqAlarm } from "@/components/SeqAlarm";
import { TodoText } from "@/components/TodoText";
import { useTodo } from "@/components/useTodo";
import {
  clearDone,
  doneCount,
  openItems,
  setDone,
  setPinned,
} from "@/lib/todo";

const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

/** How many open items the glance shows before "show all". */
const GLANCE_COUNT = 6;

/**
 * Quick capture — the command center's E2EE todo list (roadmap 53). The
 * envelope, the decrypt and the save all live in `useTodo`, so this is the
 * glance itself and nothing else; /reader writes to the same list through the
 * same hook. Renders sealed dots until the vault key is in hand (the IDB cache
 * usually means it already is), and drops the decrypted list the moment the
 * vault locks.
 */
export function TodoGlance({ offline }: { offline: boolean }) {
  const { cfg, unlocked, dataErr, seqAlarm, busy, save, capture } =
    useTodo(offline);

  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);

  // The lock edge collapses the list back to a glance: what was expanded was
  // expanded about captures that have just left with the key.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setShowAll(false);
  }

  async function add() {
    const t = text.trim();
    if (!t || busy) return;
    if (await capture(t)) setText("");
  }

  // --- render ---

  if (!unlocked || !cfg) {
    return (
      <p className="text-xs text-muted">
        {dataErr === "unreachable" ? (
          <span className="text-down">vault unreachable — reload to retry</span>
        ) : dataErr === "tamper" ? (
          <span className="text-down">cannot decrypt — lock and unlock</span>
        ) : unlocked ? (
          "decrypting…"
        ) : (
          <>
            <span className="text-muted/40">·····</span> sealed —{" "}
            <Link href="/files" className="text-amber hover:underline">
              unlock in files →
            </Link>
          </>
        )}
      </p>
    );
  }

  const open = openItems(cfg);
  const alarm = seqAlarm && <SeqAlarm what="capture list" />;
  const shown = showAll ? open : open.slice(0, GLANCE_COUNT);
  const hiddenCount = open.length - shown.length;
  const done = doneCount(cfg);

  return (
    <div className="flex flex-col gap-1 text-sm">
      {alarm}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="capture…"
          enterKeyHint="done"
          className={`min-w-0 flex-1 ${input}`}
          aria-label="new capture"
        />
        <button
          type="button"
          className={btn}
          disabled={busy || !text.trim()}
          onClick={() => void add()}
        >
          {busy ? "…" : "add"}
        </button>
      </div>

      {open.length === 0 ? (
        <p className="py-1 text-xs text-muted">nothing captured — type above</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((item) => (
            <li key={item.id} className="flex items-baseline gap-2 py-1">
              <button
                type="button"
                title="mark done"
                disabled={busy}
                onClick={() => void save((b) => setDone(b, item.id, true))}
                className="shrink-0 tabular-nums text-muted transition-colors hover:text-up"
              >
                [ ]
              </button>
              <span className="min-w-0 flex-1 break-words text-fg/90">
                <TodoText text={item.text} />
              </span>
              <button
                type="button"
                title={item.pinned ? "unpin" : "pin to top"}
                disabled={busy}
                onClick={() =>
                  void save((b) => setPinned(b, item.id, !item.pinned))
                }
                className={`shrink-0 transition-colors ${
                  item.pinned ? "text-amber" : "text-muted/40 hover:text-amber"
                }`}
              >
                *
              </button>
            </li>
          ))}
        </ul>
      )}

      {(hiddenCount > 0 || showAll || done > 0) && (
        <div className="flex items-center gap-4 text-xs text-muted">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="transition-colors hover:text-amber"
            >
              + {hiddenCount} more ▸
            </button>
          )}
          {showAll && open.length > GLANCE_COUNT && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="transition-colors hover:text-amber"
            >
              ▴ show fewer
            </button>
          )}
          {done > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(clearDone)}
              className="transition-colors hover:text-amber"
            >
              {done} done · clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
