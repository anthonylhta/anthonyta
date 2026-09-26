"use client";

import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useStudy } from "@/components/useStudy";
import { useTodo } from "@/components/useTodo";
import {
  captureText,
  EMPTY_PREFS,
  isBoosted,
  isNew,
  parsePrefs,
  parseVisit,
  parseWords,
  rankLane,
  READER_PREFS_KEY,
  READER_VISIT_KEY,
  rollVisit,
  timeAgo,
  type FeedItem,
  type LaneRead,
  type ReaderPrefs,
  type ReaderVisit,
} from "@/lib/reader";

/**
 * ReaderList — the four lanes, the "new since your last visit" memory, and the
 * device's boost + mute words (roadmap 54, ADR 0096; lanes + words 2026-09-15).
 * Read-state and taste are deliberately per-device and unsynced: two
 * localStorage records, so the server never learns what the owner has read or
 * what he wants more of, and there is no store to classify, back up or rotate.
 *
 * `now` still comes from the server render, so the ages read the same whether
 * or not the memory is available. Each lane shows six rows at rest and folds
 * the rest; a boosted row rises to its lane's top with a mark, a muted one
 * leaves with a count in the lane's header.
 */

/** How long a saved/failed row keeps saying so before returning to `+`. */
const FLASH_MS = 2000;

/** Rows a lane shows before its fold. */
const LANE_REST = 6;

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

/** The device's words, read once on mount the way the visit is (empty on the
 *  server so hydration matches), then owned by state once the owner edits. */
function useStoredPrefs(): ReaderPrefs {
  const read = useRef<ReaderPrefs | null>(null);
  const subscribe = useCallback((onStoreChange: () => void) => {
    try {
      read.current = parsePrefs(window.localStorage.getItem(READER_PREFS_KEY));
    } catch {
      read.current = EMPTY_PREFS;
    }
    onStoreChange();
    return () => {};
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => read.current ?? EMPTY_PREFS,
    () => EMPTY_PREFS,
  );
}

export function ReaderList({
  lanes,
  now,
  offline,
  sample,
}: {
  lanes: LaneRead[];
  now: number;
  offline: boolean;
  sample: boolean;
}) {
  const visit = useVisit();
  const stored = useStoredPrefs();
  // Edited words win over stored ones for the life of the page; a save writes
  // them back so the next visit reads the same taste.
  const [edited, setEdited] = useState<ReaderPrefs | null>(null);
  const prefs = edited ?? stored;
  const [tuning, setTuning] = useState(false);
  const [boostText, setBoostText] = useState("");
  const [muteText, setMuteText] = useState("");

  function openTune() {
    setBoostText(prefs.boost.join(", "));
    setMuteText(prefs.mute.join(", "));
    setTuning(true);
  }
  function saveTune() {
    const next = { boost: parseWords(boostText), mute: parseWords(muteText) };
    setEdited(next);
    setTuning(false);
    try {
      window.localStorage.setItem(READER_PREFS_KEY, JSON.stringify(next));
    } catch {
      // A blocked store just means the words last as long as the page.
    }
  }

  // "Read later" — a headline into the E2EE capture list, through the same hook
  // the homepage board writes with. Only offered once the vault is open: locked
  // (and offline, which is locked's cause), the page is exactly what it was, with
  // nothing sealed-looking to explain.
  const todo = useTodo(offline);
  const [flash, setFlash] = useState<{ link: string; ok: boolean } | null>(
    null,
  );
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  // "Studied" — a japan-lane headline into the E2EE study log, as today's
  // sitting: the same hook the palette's `ja` verb writes through, offered on
  // the same terms as the save beside it.
  const study = useStudy(offline);
  const [studyFlash, setStudyFlash] = useState<{
    link: string;
    ok: boolean;
  } | null>(null);

  async function studyItem(item: FeedItem) {
    const ok = await study.log(item.title);
    setStudyFlash({ link: item.link, ok });
    setTimeout(
      () => setStudyFlash((f) => (f?.link === item.link ? null : f)),
      FLASH_MS,
    );
  }

  async function saveItem(item: FeedItem) {
    const ok = await todo.capture(captureText(item.title, item.link));
    setFlash({ link: item.link, ok });
    // The row says what happened for a beat, then goes back to offering. A
    // newer tap has its own say — don't clear someone else's.
    setTimeout(
      () => setFlash((f) => (f?.link === item.link ? null : f)),
      FLASH_MS,
    );
  }

  const wordsLine = (label: string, words: string[]): ReactNode => (
    <span>
      <span className="text-muted/60">{label}</span>{" "}
      {words.length > 0 ? (
        words.join(" · ")
      ) : (
        <span className="text-muted/40">—</span>
      )}
    </span>
  );

  return (
    <>
      {/* The tune row: the device's words, and the refresh rhythm. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-4 py-2 text-xs text-muted">
        {tuning ? (
          <form
            className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              saveTune();
            }}
          >
            <label className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="text-muted/60">boost</span>
              <input
                value={boostText}
                onChange={(e) => setBoostText(e.target.value)}
                placeholder="words, comma separated"
                className="min-w-0 flex-1 border-b border-hairline bg-transparent text-fg placeholder:text-muted/40 focus:outline-none"
              />
            </label>
            <label className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="text-muted/60">mute</span>
              <input
                value={muteText}
                onChange={(e) => setMuteText(e.target.value)}
                placeholder="words, comma separated"
                className="min-w-0 flex-1 border-b border-hairline bg-transparent text-fg placeholder:text-muted/40 focus:outline-none"
              />
            </label>
            <span className="flex gap-2">
              <button
                type="submit"
                className="rounded-[2px] border border-hairline bg-surface px-[5px] text-[10px] text-fg/85 transition-colors hover:border-amber"
              >
                save
              </button>
              <button
                type="button"
                onClick={() => setTuning(false)}
                className="rounded-[2px] border border-hairline bg-surface px-[5px] text-[10px] text-muted transition-colors hover:border-amber"
              >
                cancel
              </button>
            </span>
          </form>
        ) : (
          <>
            {wordsLine("boost", prefs.boost)}
            {wordsLine("mute", prefs.mute)}
            <button
              type="button"
              onClick={openTune}
              className="rounded-[2px] border border-hairline bg-surface px-[5px] text-[10px] text-fg/85 transition-colors hover:border-amber"
            >
              tune
            </button>
          </>
        )}
        {sample && (
          <span className="border border-hairline px-1.5 py-0.5 text-[10px]">
            sample — feeds unreachable
          </span>
        )}
        {!tuning && <span className="ml-auto">refreshes every 30 min</span>}
      </div>

      {lanes.map((lane) => {
        const { shown, muted } = rankLane(lane.items, prefs);
        const fresh =
          visit === null ? 0 : shown.filter((i) => isNew(i, visit)).length;
        const isOpen = open.has(lane.key);
        const rows = isOpen ? shown : shown.slice(0, LANE_REST);
        const rest = shown.length - LANE_REST;
        return (
          <section key={lane.key} aria-label={lane.label}>
            <div className="flex items-baseline justify-between gap-3 border-b border-hairline bg-amber/[0.04] px-4 py-1.5">
              <span className="shrink-0 text-[10px] uppercase tracking-[0.22em] text-amber/85">
                ▍ {lane.label}
              </span>
              <span className="min-w-0 truncate text-[10px] text-muted">
                {/* The sources hide on the phone so the count keeps its room;
                    each row names its source after the headline there. */}
                <span className="hidden sm:inline">
                  {lane.sources.join(" · ")}
                  {muted > 0 && (
                    <span className="text-muted/60"> · {muted} muted</span>
                  )}
                  {fresh > 0 && " · "}
                </span>
                {fresh > 0 && <span className="text-amber">{fresh} new</span>}
              </span>
            </div>

            <div className="flex flex-col">
              {rows.length === 0 && (
                <p className="px-4 py-2 text-xs text-muted/60">
                  nothing reachable this half hour
                </p>
              )}
              {rows.map((item) => (
                // The row is the wrapper, not the link: a button inside an anchor
                // is invalid, so the two sit side by side and the anchor takes the
                // rest.
                <div
                  key={item.link}
                  className="flex items-baseline border-t border-hairline/60 transition-colors first:border-t-0 hover:bg-surface/30"
                >
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 flex-1 items-baseline gap-3 px-4 py-2"
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
                    <span className="hidden w-24 shrink-0 truncate text-[10px] uppercase tracking-[0.12em] text-muted sm:inline">
                      {item.source}
                    </span>
                    <span
                      lang={item.lang}
                      className={`min-w-0 flex-1 text-sm text-fg/90 ${
                        item.lang === "ja"
                          ? "font-[family-name:var(--font-jp)] leading-relaxed"
                          : ""
                      }`}
                    >
                      {isBoosted(item, prefs) && (
                        <span
                          aria-label="boosted"
                          className="mr-1.5 text-[10px] text-amber/70"
                        >
                          ▲
                        </span>
                      )}
                      {item.title}
                      <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-muted/60 sm:hidden">
                        {item.source}
                      </span>
                    </span>
                  </a>
                  {/* Fixed width so "saved" doesn't shove the headline sideways;
                      the japan lane's cell is wider for its second verb. */}
                  {todo.unlocked && (
                    <span
                      className={`flex shrink-0 items-baseline ${
                        lane.key === "japan" ? "w-24" : "w-16"
                      }`}
                    >
                      {lane.key === "japan" && (
                        <button
                          type="button"
                          aria-label="log as studied today"
                          title="studied"
                          disabled={study.busy}
                          onClick={() => void studyItem(item)}
                          className="shrink-0 whitespace-nowrap py-2 pl-2 text-xs text-muted/60 transition-colors hover:text-amber disabled:opacity-40"
                        >
                          {studyFlash?.link === item.link ? (
                            studyFlash.ok ? (
                              "logged"
                            ) : (
                              "!"
                            )
                          ) : (
                            <span
                              lang="ja"
                              className="font-[family-name:var(--font-jp)]"
                            >
                              学
                            </span>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="save to needs doing"
                        disabled={todo.busy}
                        onClick={() => void saveItem(item)}
                        className="flex-1 whitespace-nowrap py-2 pl-2 pr-4 text-right text-xs text-muted/60 transition-colors hover:text-amber disabled:opacity-40"
                      >
                        {flash?.link === item.link
                          ? flash.ok
                            ? "saved"
                            : "!"
                          : "+"}
                      </button>
                    </span>
                  )}
                </div>
              ))}
              {rest > 0 && (
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (n.has(lane.key)) n.delete(lane.key);
                      else n.add(lane.key);
                      return n;
                    })
                  }
                  className="border-t border-hairline/60 px-4 py-1.5 text-left text-[11px] text-muted/60 transition-colors hover:text-amber"
                >
                  {isOpen ? "▾ fewer" : `▸ ${rest} more`}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
