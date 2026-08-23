"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { NoteHit, NoteSearch } from "@/lib/vaultquery";

type Item = { label: string; href: string; hint?: string };

const PaletteCtx = createContext<{ open: () => void } | null>(null);

/** How many note rows the vault section may add. */
const VAULT_K = 5;
/** Nothing vault-shaped is attempted below this many characters. */
const VAULT_MIN_QUERY = 2;
/** One shared empty list, so "no vault matches" stays referentially stable. */
const NO_HITS: Item[] = [];

/**
 * Load the vault search, or nothing at all. The ordering is the privacy design
 * (ADR 0022): step one asks the device key cache, and a guest — or a locked owner —
 * ends there, having fetched nothing and changed nothing on screen. Only a browser
 * that already holds the master key reaches step two and touches the vault at all.
 * Both imports are dynamic, which keeps the crypto and the index format out of this
 * file's chunk — the palette lives in the layout, so that chunk is loaded on every
 * page by everyone. Every failure is silence: the palette then behaves exactly as
 * it did before this feature existed.
 */
async function loadVaultSearch(): Promise<NoteSearch | null> {
  try {
    const { getCachedKey } = await import("@/lib/keycache");
    const mk = await getCachedKey();
    if (!mk) return null;
    const { loadNoteSearch } = await import("@/lib/vaultquery");
    return await loadNoteSearch(mk);
  } catch {
    return null;
  }
}

/**
 * The vault matches for the current query, as palette rows. A guest can never reach
 * past the first line of `loadVaultSearch`: the palette must be open, the query long
 * enough to be a search rather than a keystroke, and the device must hold an unlocked
 * master key. One attempt per opening while it keeps coming back empty-handed (so an
 * unlock elsewhere in the tab is picked up on the next ⌘K), and the loaded index is
 * kept in memory — never on disk — for the rest of the page's life.
 */
function useVaultMatches(open: boolean, query: string): Item[] {
  // Results carry the query they answer, so a keystroke hides them without a
  // clearing setState — the palette never shows the previous query's notes.
  const [hits, setHits] = useState<{ q: string; items: Item[] }>({
    q: "",
    items: NO_HITS,
  });
  const searchRef = useRef<NoteSearch | null>(null);
  const attemptRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const text = query.trim();
    if (!open) attemptRef.current = null; // the next opening probes afresh
    if (!open || text.length < VAULT_MIN_QUERY) return;
    let cancelled = false;
    (async () => {
      if (!searchRef.current) {
        attemptRef.current ??= loadVaultSearch().then((s) => {
          searchRef.current = s;
        });
        await attemptRef.current;
      }
      const search = searchRef.current;
      if (cancelled || !search) return;
      setHits({ q: text, items: search(text, VAULT_K).map(toItem) });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, query]);

  return open && hits.q === query.trim() ? hits.items : NO_HITS;
}

/** A note hit as a palette row — same shape as a navigation item, so selecting one
 *  travels the identical path. */
function toItem(hit: NoteHit): Item {
  return { label: hit.title, href: `/vault/${hit.noteId}` };
}

/**
 * ⌘K / Ctrl-K command palette — the fastest way to move around the hub, and a piece
 * of the terminal identity. The provider owns the modal + the global keydown
 * listener (mounted once in the layout); <CommandK> triggers can live anywhere below
 * it — currently in the lobby + command-center footers. Navigation, plus — for an
 * owner whose vault is already unlocked on this device — the notes matching what
 * they typed (see `useVaultMatches`; a guest's palette is navigation and nothing
 * else, which is the whole design).
 */
export function CommandPaletteProvider({
  items,
  children,
}: {
  items: Item[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  // Vault notes, when there are any — always empty for a guest, so everything
  // downstream (the active index, the "no matches" line) collapses to today's
  // behaviour byte for byte.
  const vaultHits = useVaultMatches(open, query);
  const rows = useMemo(
    () => [...filtered, ...vaultHits],
    [filtered, vaultHits],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback(
    (item: Item | undefined) => {
      if (!item) return;
      close();
      router.push(item.href);
    },
    [close, router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const ctx = useMemo(() => ({ open: () => setOpen(true) }), []);

  return (
    <PaletteCtx.Provider value={ctx}>
      {children}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[18vh]"
          onClick={close}
        >
          <div
            className="w-full max-w-md border border-hairline bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, rows.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  go(rows[active]);
                }
              }}
              placeholder="jump to…"
              className="w-full border-b border-hairline bg-transparent px-3 py-2.5 text-sm text-fg placeholder:text-muted focus:outline-none"
            />
            <ul className="max-h-72 overflow-y-auto py-1">
              {rows.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">no matches</li>
              )}
              {filtered.map((item, i) => (
                <Row
                  key={item.href}
                  item={item}
                  active={i === active}
                  onHover={() => setActive(i)}
                  onSelect={() => go(item)}
                />
              ))}
              {/* Only ever drawn when the query found notes — no label, no divider,
                  nothing at all for a guest. */}
              {vaultHits.length > 0 && (
                <li className="mt-1 border-t border-hairline px-3 pb-1 pt-2 text-[10px] uppercase tracking-[0.2em] text-muted">
                  vault
                </li>
              )}
              {vaultHits.map((item, i) => (
                <Row
                  key={item.href}
                  item={item}
                  active={filtered.length + i === active}
                  onHover={() => setActive(filtered.length + i)}
                  onSelect={() => go(item)}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </PaletteCtx.Provider>
  );
}

/** One selectable row. Navigation items and note hits are the same shape, so they
 *  look and behave alike — a note is just another place to jump to. */
function Row({
  item,
  active,
  onHover,
  onSelect,
}: {
  item: Item;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseEnter={onHover}
        onClick={onSelect}
        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
          active ? "bg-amber/10 text-amber" : "text-fg"
        }`}
      >
        <span className="truncate">{item.label}</span>
        {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
      </button>
    </li>
  );
}

/** ⌘K trigger button — place anywhere inside the provider (e.g. a footer). */
export function CommandK({ className }: { className?: string }) {
  const ctx = useContext(PaletteCtx);
  return (
    <button
      type="button"
      onClick={() => ctx?.open()}
      aria-label="Open command palette"
      className={
        className ??
        "rounded border border-hairline px-2 py-1 text-xs text-muted transition-colors hover:border-amber hover:text-fg"
      }
    >
      ⌘K
    </button>
  );
}
