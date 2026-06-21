"use client";

import { useEffect, useRef } from "react";

// The lobby's terminal prompt. A few quick taps submit the #gh-auth form — the
// touch counterpart to the key sequence (phones have no keyboard). The listener
// is attached by ref, not a JSX onClick, so the prompt stays a plain <p>.
const TAPS = 5;
const WINDOW_MS = 2000;

export function Prompt({ tagline }: { tagline: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let taps: number[] = [];
    const onTap = () => {
      const now = Date.now();
      taps = [...taps, now].filter((t) => now - t < WINDOW_MS);
      if (taps.length >= TAPS) {
        taps = [];
        const form = document.getElementById("gh-auth");
        if (form instanceof HTMLFormElement) form.requestSubmit();
      }
    };
    el.addEventListener("click", onTap);
    return () => el.removeEventListener("click", onTap);
  }, []);

  return (
    <div className="border-b border-hairline px-4 py-6">
      <p
        ref={ref}
        className="touch-manipulation select-none text-sm text-muted"
      >
        <span className="text-amber">&gt;</span>{" "}
        <span className="cursor text-fg">{tagline}</span>
      </p>
    </div>
  );
}
