"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

/** The fragment that names the folded-open lobby — what `/live` redirects onto. */
const LIVE = "#live";

/** `history.replaceState` fires no event of its own, so the fold announces its
 *  own writes on this one; a hash typed or followed in the bar fires the other. */
const FOLD_EVENT = "lobbyfold";

function subscribeToFragment(onStoreChange: () => void) {
  window.addEventListener("hashchange", onStoreChange);
  window.addEventListener(FOLD_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("hashchange", onStoreChange);
    window.removeEventListener(FOLD_EVENT, onStoreChange);
  };
}

/**
 * Is the slice open — asked of the URL, which is where the answer lives. Reading
 * it through `useSyncExternalStore` (the ReaderList pattern) means a `/#live`
 * arrival opens the fold without a setState inside an effect, and the server
 * always renders the closed page, so hydration matches whatever the visitor
 * typed.
 */
function useFoldOpen(): boolean {
  return useSyncExternalStore(
    subscribeToFragment,
    () => window.location.hash === LIVE,
    () => false,
  );
}

/** Open or close the slice by rewriting the fragment — no navigation, no entry
 *  pushed onto the back stack, and a URL that says what the page is showing. */
function setFoldOpen(open: boolean) {
  history.replaceState(
    null,
    "",
    open ? LIVE : window.location.pathname + window.location.search,
  );
  window.dispatchEvent(new Event(FOLD_EVENT));
}

/**
 * The guest front door's frame — the card, and the dashboard folded under it.
 *
 * The lobby used to open with every live module at once, which made a visitor
 * read a dashboard to learn who I am. Now the card (prompt → the now block → a
 * three-fact pulse) is the whole first screen, vertically centred with nothing
 * to scroll, and the modules sit behind one row: "the live slice". Closed on
 * EVERY visit — no localStorage, no memory — because the card answers the
 * question a stranger arrived with, and the slice is for the one who wants
 * proof.
 *
 * Client, and holding the `<main>` itself, for one reason: opening the fold has
 * to drop `justify-center` (a centred column with a dashboard under it is a
 * column that jumps), and that class sits on the frame rather than on anything
 * the server could hand down.
 */
export function LobbyFrame({
  card,
  pulse,
  sliceLabel,
  slice,
  nav,
}: {
  /** Status bar, prompt, now block — the front door itself. */
  card: ReactNode;
  /** The pulse row's live facts; the `live →` handle is this component's. */
  pulse: ReactNode;
  /** The fold row's label, or null when the owner has hidden every module. */
  sliceLabel: string | null;
  /** The lobby's modules, rendered on the server and shown only when open. */
  slice: ReactNode;
  nav: ReactNode;
}) {
  const open = useFoldOpen();
  const foldRef = useRef<HTMLDivElement>(null);
  // The first pass neither scrolls nor jumps: it is the page as loaded, not
  // something the reader just did.
  const settled = useRef(false);

  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    if (open) foldRef.current?.scrollIntoView({ block: "start" });
    else window.scrollTo({ top: 0 });
  }, [open]);

  return (
    <main
      className={`mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6${
        open ? "" : " justify-center"
      }`}
    >
      <div className="border border-hairline bg-surface/20">
        {card}

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-5 py-3 text-[11px] text-muted">
          {pulse}
          {sliceLabel && (
            <a
              href={LIVE}
              onClick={(e) => {
                e.preventDefault();
                setFoldOpen(true);
              }}
              className="ml-auto text-amber hover:underline"
            >
              live →
            </a>
          )}
        </div>

        {sliceLabel && (
          <>
            <div ref={foldRef} className="border-b border-hairline px-5 py-2.5">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setFoldOpen(!open)}
                className="flex w-full items-baseline gap-2 text-left text-xs leading-[22px]"
              >
                <span className="w-2.5 shrink-0 text-muted/40">
                  {open ? "▾" : "▸"}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {sliceLabel}
                </span>
              </button>
            </div>
            {open && slice}
          </>
        )}

        {nav}
      </div>

      <p className="mt-4 text-center text-xs text-muted/50">
        warm terminal · reading is live
      </p>
    </main>
  );
}
