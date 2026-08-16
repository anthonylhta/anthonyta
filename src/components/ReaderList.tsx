"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import {
  isNew,
  parseVisit,
  READER_VISIT_KEY,
  rollVisit,
  timeAgo,
  type FeedItem,
  type ReaderVisit,
} from "@/lib/reader";

/**
 * ReaderList — the timeline rows, plus the "new since your last visit" memory
 * (roadmap 54, ADR 0096). Read-state is deliberately per-device and unsynced:
 * one localStorage record holding two timestamps, so the server never learns
 * what the owner has read and there is no store to classify, back up or rotate.
 *
 * The rows are otherwise unchanged — a marker is only which colour the age cell
 * wears, plus a count above the list. `now` still comes from the server render,
 * so the ages read the same whether or not the memory is available.
 */

/** Read, roll, write — best effort. A blocked or full store just means this
 *  device shows no markers, which is exactly what the page did before. */
function rollStoredVisit(now: number): ReaderVisit | null {
  try {
    const visit = rollVisit(
      parseVisit(window.localStorage.getItem(READER_VISIT_KEY)),
      now,
    );
    window.localStorage.setItem(READER_VISIT_KEY, JSON.stringify(visit));
    return visit;
  } catch {
    return null;
  }
}

/**
 * The visit this render runs on: null on the server and on the first client
 * paint — so the markup matches and hydration is clean — then the rolled
 * record. The roll happens when React subscribes, which is after mount, so it
 * is an effect in all but name; `useSyncExternalStore` is how its result
 * reaches the page without a setState inside an effect (the InstallPrompt
 * pattern). Rolling twice (a remount, React's development double-invoke) is
 * harmless: the second roll lands inside the session it just wrote and returns
 * the same record.
 */
function useVisit(): ReaderVisit | null {
  const rolled = useRef<ReaderVisit | null>(null);
  const subscribe = useCallback((onStoreChange: () => void) => {
    rolled.current = rollStoredVisit(Date.now());
    onStoreChange();
    // Nothing to unsubscribe from — the memory is read once per visit, not
    // watched. A later tab is a later visit, with its own roll.
    return () => {};
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => rolled.current,
    () => null,
  );
}

export function ReaderList({ items, now }: { items: FeedItem[]; now: number }) {
  const visit = useVisit();
  const fresh =
    visit === null ? 0 : items.filter((i) => isNew(i, visit)).length;

  return (
    <>
      {fresh > 0 && (
        <p className="border-b border-hairline px-4 py-1.5 text-[11px] text-amber">
          {fresh} new since your last visit
        </p>
      )}

      <div className="flex flex-col">
        {items.map((item) => (
          <a
            key={item.link}
            href={item.link}
            target="_blank"
            rel="noreferrer"
            className="flex items-baseline gap-3 border-t border-hairline/60 px-4 py-2 transition-colors first:border-t-0 hover:bg-surface/30"
          >
            <span
              className={`w-10 shrink-0 tabular-nums text-xs ${
                visit !== null && isNew(item, visit)
                  ? "text-amber"
                  : "text-muted"
              }`}
            >
              {timeAgo(item.ts, now)}
            </span>
            <span className="w-24 shrink-0 truncate text-[10px] uppercase tracking-[0.12em] text-muted">
              {item.source}
            </span>
            <span className="min-w-0 flex-1 text-sm text-fg/90">
              {item.title}
            </span>
          </a>
        ))}
      </div>
    </>
  );
}
