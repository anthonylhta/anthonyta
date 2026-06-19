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

/**
 * Top bar of the terminal shell: name, live Sydney clock, and a session indicator.
 * `user` is "guest" on the public lobby; the private command center passes the
 * signed-in handle (ADR 0004).
 */
export function StatusBar({ user = "guest" }: { user?: string }) {
  const [time, setTime] = useState("--:--");

  useEffect(() => {
    const tick = () => setTime(sydneyNow());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  const live = user !== "guest";

  return (
    <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
      <span className="font-semibold tracking-wide text-fg">anthony ta</span>
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
