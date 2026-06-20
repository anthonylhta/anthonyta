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

type Item = { label: string; href: string; hint?: string };

const PaletteCtx = createContext<{ open: () => void } | null>(null);

/**
 * ⌘K / Ctrl-K command palette — the fastest way to move around the hub, and a piece
 * of the terminal identity. The provider owns the modal + the global keydown
 * listener (mounted once in the layout); <CommandK> triggers can live anywhere below
 * it — currently in the lobby + command-center footers. Navigation-only for now.
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
                  setActive((a) => Math.min(a + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  go(filtered[active]);
                }
              }}
              placeholder="jump to…"
              className="w-full border-b border-hairline bg-transparent px-3 py-2.5 text-sm text-fg placeholder:text-muted focus:outline-none"
            />
            <ul className="max-h-72 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">no matches</li>
              )}
              {filtered.map((item, i) => (
                <li key={item.href}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                      i === active ? "bg-amber/10 text-amber" : "text-fg"
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.hint && (
                      <span className="text-xs text-muted">{item.hint}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </PaletteCtx.Provider>
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
