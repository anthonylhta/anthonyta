"use client";

import { useEffect, useState } from "react";

function sydneyNow(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

/** The signed-in left slot's Sydney calendar day — "fri 7 aug", the agenda
 *  header's format. */
function sydneyDay(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Sydney",
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(new Date())
    .toLowerCase();
}

/**
 * Top bar of the terminal shell: identity or the day, a live Sydney clock, and a
 * session indicator. `user` is "guest" on the public lobby, which keeps the name —
 * the public face introduces its owner (ADR 0004). Signed in, the me-block owns
 * identity, so the left slot carries the Sydney date instead and the bar reads as
 * a complete time header: date left, clock right.
 */
export function StatusBar({ user = "guest" }: { user?: string }) {
  const [time, setTime] = useState("--:--");
  // Seeded at render so the date is already right in the server HTML (every page
  // is request-dynamic); the tick keeps it honest across midnight. The hydration
  // suppression below covers the rare render that straddles a day boundary — the
  // first tick corrects it.
  const [day, setDay] = useState(sydneyDay);

  useEffect(() => {
    const tick = () => {
      setTime(sydneyNow());
      setDay(sydneyDay());
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  const live = user !== "guest";

  return (
    <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
      <span
        suppressHydrationWarning
        className="font-semibold tracking-wide text-fg"
      >
        {live ? day : "anthony ta"}
      </span>
      <span className="flex items-center gap-3 text-muted">
        <span className="flex items-center gap-1.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-up" : "bg-muted"}`}
            aria-hidden
          />
          {user}
        </span>
        <span className="text-hairline">·</span>
        <span>
          <span className="text-muted/70">sydney</span> {time}
        </span>
      </span>
    </div>
  );
}
