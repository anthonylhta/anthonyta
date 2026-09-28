"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Inline spoiler folds for a review. Every span renders folded (on the server
 * too, so hydration matches); one tap opens a span, the header toggle opens or
 * folds all of them. Spans register their `k` on mount so the toggle knows
 * when every one is open.
 */
interface SpoilerState {
  open: Set<string>;
  keys: Set<string>;
  register: (k: string) => void;
  toggle: (k: string) => void;
  toggleAll: () => void;
}

const Ctx = createContext<SpoilerState | null>(null);

export function SpoilerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [keys, setKeys] = useState<Set<string>>(() => new Set());

  const register = useCallback((k: string) => {
    setKeys((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
  }, []);
  const toggle = useCallback((k: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);
  const allOpen = keys.size > 0 && [...keys].every((k) => open.has(k));
  const toggleAll = useCallback(() => {
    setOpen(allOpen ? new Set() : new Set(keys));
  }, [allOpen, keys]);

  return (
    <Ctx.Provider value={{ open, keys, register, toggle, toggleAll }}>
      {children}
    </Ctx.Provider>
  );
}

/** The header button: `show all` while any span is folded, else `fold all`. */
export function SpoilerToggle() {
  const s = useContext(Ctx);
  if (!s) return null;
  const allOpen = s.keys.size > 0 && [...s.keys].every((k) => s.open.has(k));
  return (
    <button
      type="button"
      onClick={s.toggleAll}
      className="cursor-pointer text-amber hover:underline"
    >
      {allOpen ? "fold all" : "show all"}
    </button>
  );
}

const chipClass =
  "rounded-[2px] border border-dashed border-hairline px-1.5 font-mono text-[11px] tracking-[0.08em] whitespace-nowrap";

/** One inline spoiler, folded to a chip until tapped. */
export function Spoiler({ k, children }: { k: string; children: ReactNode }) {
  const s = useContext(Ctx);
  const register = s?.register;
  useEffect(() => {
    register?.(k);
  }, [register, k]);

  if (s?.open.has(k)) {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label="fold spoiler"
        onClick={() => s.toggle(k)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            s.toggle(k);
          }
        }}
        className="cursor-pointer bg-amber/8 [box-decoration-break:clone]"
      >
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label="show spoiler"
      onClick={() => s?.toggle(k)}
      className={`${chipClass} cursor-pointer text-muted hover:border-amber hover:text-amber`}
    >
      ▒ spoiler ▒
    </button>
  );
}
