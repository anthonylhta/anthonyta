"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The install affordance for the PWA — plus the one place the service worker is
 * registered (public/sw.js). Renders nothing until the app is actually
 * installable, and nothing at all once it's running standalone.
 *
 * Two install paths:
 *  - Chromium/Android fires `beforeinstallprompt`; we stash it and drive the
 *    native sheet from our own terminal-styled button.
 *  - iOS Safari has no such event, so we detect it and show the manual
 *    Share → "Add to Home Screen" recipe instead.
 * A dismissal is remembered in localStorage so the chip doesn't nag.
 *
 * The platform checks read browser-only APIs, so they must run after hydration
 * or the server/client markup diverges. `hydrated` (via useSyncExternalStore)
 * is false on the server and true on the client without a setState-in-effect,
 * and everything visible is derived from it during render.
 */
const DISMISS_KEY = "pwa-install-dismissed";

// Minimal shape of the non-standard beforeinstallprompt event.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const noop = () => () => {};

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari exposes standalone here rather than via display-mode.
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

function isIos() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !/crios|fxios|edgios/i.test(navigator.userAgent) // Chrome/Firefox/Edge on iOS can't install
  );
}

function wasDismissed() {
  try {
    return !!localStorage.getItem(DISMISS_KEY);
  } catch {
    return false; // private mode can throw on read
  }
}

export function InstallPrompt() {
  // false on the server, true after the client mounts — no hydration mismatch.
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [iosSteps, setIosSteps] = useState(false);

  // Register the service worker once, regardless of install state.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () =>
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // A failed registration must never break the page; offline is a bonus.
      });
    if (document.readyState === "complete") onLoad();
    else {
      window.addEventListener("load", onLoad);
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  // Capture Chromium's install event (and clear on a completed install). Both
  // setState calls live in listener callbacks, never in the effect body.
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault(); // keep Chrome's mini-infobar from stealing it
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // private mode can throw on write — fine, the chip is just gone for now
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setInstalled(true);
  }

  // Derive visibility entirely from render-time reads (all client-only).
  const eligible =
    hydrated && !installed && !dismissed && !isStandalone() && !wasDismissed();
  const ios = eligible && isIos();
  const showButton = eligible && !ios && deferred !== null;

  if (!ios && !showButton) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
      <div className="w-full max-w-md border border-hairline bg-surface/95 backdrop-blur-sm shadow-lg">
        <div className="flex items-center justify-between border-b border-hairline px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
          <span>
            <span className="text-amber">&gt;</span> install
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="dismiss install prompt"
            className="text-muted hover:text-amber"
          >
            ✕
          </button>
        </div>

        <div className="px-3 py-3 text-sm">
          {ios ? (
            <div className="space-y-2">
              <p className="text-fg/90">
                Add the hub to your home screen so it opens like an app.
              </p>
              {iosSteps ? (
                <ol className="ml-4 list-decimal space-y-1 text-xs text-muted">
                  <li>
                    Tap the Share icon <span className="text-amber">↑</span> in
                    Safari&apos;s toolbar.
                  </li>
                  <li>
                    Choose <span className="text-fg">Add to Home Screen</span>.
                  </li>
                  <li>
                    Tap <span className="text-fg">Add</span> — the hub lands on
                    your home screen.
                  </li>
                </ol>
              ) : (
                <button
                  type="button"
                  onClick={() => setIosSteps(true)}
                  className="border border-hairline px-3 py-1.5 text-xs text-amber hover:bg-amber hover:text-bg"
                >
                  show me how
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-fg/90">
                Add the hub to your home screen for one-tap access.
              </p>
              <button
                type="button"
                onClick={install}
                className="shrink-0 border border-hairline px-3 py-1.5 text-xs text-amber hover:bg-amber hover:text-bg"
              >
                install
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
