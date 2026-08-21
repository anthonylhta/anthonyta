"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { fromB64url } from "@/lib/crypto";
import { PUSH_CATEGORIES, type PushCategory, type PushView } from "@/lib/push";

const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

const noop = () => () => {};

/** Whether this browser can be pushed to at all — an iOS browser outside the
 *  installed PWA is the usual "no". Read through `useSyncExternalStore` rather
 *  than an effect: `PushManager` doesn't exist during the server render, so the
 *  server snapshot is a flat `false` and the real answer arrives at hydration —
 *  no mismatch, and no setState cascade. */
function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

type Phase = "loading" | "ready" | "unreachable";
type Enroll = "idle" | "busy" | "done" | "denied" | "failed";

/** What each toggle actually costs the owner in attention — the panel says so,
 *  because "signin" alone doesn't explain why you'd want to be told. */
const CATEGORY_COPY: Record<PushCategory, string> = {
  dropbox: "sealed mail arrives in the drop box",
  signin: "a passkey opens the door",
  ingest: "the phone stops posting steps or sleep",
};

/** A short, human device name — the passkey manager's sniff, same reasoning:
 *  purely cosmetic, never trusted, just enough to tell two phones apart. */
function deviceLabel(): string {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const raw = nav.userAgentData?.platform || navigator.platform || "device";
  return raw.toLowerCase().slice(0, 64);
}

/** An ISO stamp as a bare Sydney day — the device list wants "when", not "when to the second". */
function day(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Australia/Sydney",
      day: "numeric",
      month: "short",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * The /system push band — the owner enrolls a device, names which of the three
 * categories may interrupt, and drops devices that are gone.
 *
 * Every off-state is stated honestly rather than hidden, because all three are
 * real and each has a different fix: no VAPID keys in the env (the whole feature
 * is off), no R2 (nowhere to store a subscription), and no PushManager (an iOS
 * browser outside the installed PWA, most often). Guessing between them would
 * leave the owner tapping a button that can't work.
 */
export function PushPanel({
  offline,
  vapidPublicKey,
}: {
  offline: boolean;
  vapidPublicKey: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [view, setView] = useState<PushView | null>(null);
  const [enroll, setEnroll] = useState<Enroll>("idle");
  const supported = useSyncExternalStore(noop, pushSupported, () => false);

  const dead = offline || vapidPublicKey === null;

  useEffect(() => {
    if (dead) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/push");
        if (!res.ok) throw new Error(`push: ${res.status}`);
        const parsed = (await res.json()) as PushView;
        if (cancelled) return;
        setView(parsed);
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dead]);

  if (vapidPublicKey === null)
    return (
      <p className="text-xs text-muted">
        no keys configured — set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
        VAPID_SUBJECT
      </p>
    );
  if (offline)
    return (
      <p className="text-xs text-muted">
        store offline — set the R2_* env vars
      </p>
    );
  if (phase === "loading")
    return <p className="text-xs text-muted">loading…</p>;
  if (phase === "unreachable" || !view)
    return (
      <p className="text-xs text-down">
        push store unreachable — reload to retry
      </p>
    );

  async function subscribe() {
    if (vapidPublicKey === null) return;
    setEnroll("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setEnroll("denied");
        return;
      }
      // Registration is idempotent; /system doesn't render the install prompt
      // that normally registers the worker, so do it here before awaiting ready.
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // re-wrapped so the type is Uint8Array<ArrayBuffer>, which BufferSource pins
        applicationServerKey: new Uint8Array(fromB64url(vapidPublicKey)),
      });
      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          label: deviceLabel(),
        }),
      });
      if (!res.ok) throw new Error(`enroll: ${res.status}`);
      setView((await res.json()) as PushView);
      setEnroll("done");
    } catch {
      setEnroll("failed");
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/push?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`remove: ${res.status}`);
      setView((await res.json()) as PushView);
    } catch {
      setPhase("unreachable");
    }
  }

  async function toggle(category: PushCategory, on: boolean) {
    const previous = view;
    if (!previous) return;
    // Optimistic: a checkbox that waits on a round-trip feels broken. The
    // server's answer replaces it, and a failure puts the old state back.
    setView({
      ...previous,
      categories: { ...previous.categories, [category]: on },
    });
    try {
      const res = await fetch("/api/push", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categories: { [category]: on } }),
      });
      if (!res.ok) throw new Error(`toggle: ${res.status}`);
      setView((await res.json()) as PushView);
    } catch {
      setView(previous);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <p className="mb-1.5 text-[11px] uppercase tracking-[0.15em] text-muted">
          devices
        </p>
        {view.subs.length === 0 ? (
          <p className="text-xs text-muted">none enrolled</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {view.subs.map((s) => (
              <li key={s.id} className="flex items-baseline gap-3 text-[13px]">
                <span className="min-w-0 truncate">{s.label}</span>
                <span className="text-xs tabular-nums text-muted">
                  {day(s.created)}
                </span>
                <button
                  type="button"
                  className="text-xs text-muted transition-colors hover:text-down"
                  onClick={() => void remove(s.id)}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-[11px] uppercase tracking-[0.15em] text-muted">
          tap my shoulder when
        </p>
        <div className="flex flex-col gap-0.5">
          {PUSH_CATEGORIES.map((category) => {
            const on = view.categories[category] === true;
            return (
              <button
                key={category}
                type="button"
                aria-pressed={on}
                onClick={() => void toggle(category, !on)}
                className={`text-left text-[13px] transition-colors hover:text-amber ${
                  on ? "text-fg" : "text-muted/60"
                }`}
              >
                <span className="tabular-nums">[{on ? "x" : " "}]</span>{" "}
                {CATEGORY_COPY[category]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {!supported ? (
          <p className="text-xs text-muted">
            not supported here — install the app, or use a browser with push
          </p>
        ) : (
          <button
            type="button"
            className={btn}
            disabled={enroll === "busy"}
            onClick={() => void subscribe()}
          >
            {enroll === "busy" ? "enabling…" : "enable on this device"}
          </button>
        )}
        {enroll === "done" && (
          <span className="text-xs text-up">enabled on this device</span>
        )}
        {enroll === "denied" && (
          <span className="text-xs text-down">
            permission denied — allow notifications in site settings
          </span>
        )}
        {enroll === "failed" && (
          <span className="text-xs text-down">enable failed — try again</span>
        )}
      </div>
    </div>
  );
}
