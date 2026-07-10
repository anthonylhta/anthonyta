"use client";

import { useRef } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { signIn } from "next-auth/react";

/**
 * The hidden door, WebAuthn edition. Renders the same invisible #gh-auth form
 * the secret keystroke (key-shortcut.tsx) and the lobby 5-tap (Prompt.tsx)
 * requestSubmit() — but submit now runs the passkey ceremony in-page: one fast
 * same-origin fetch for options, then navigator.credentials.get via
 * startAuthentication, then the assertion through Auth.js. No redirect, no
 * third-party hop for a network observer to see — strictly better for
 * ADR 0022 than the GitHub bounce.
 *
 * The options fetch is the ONLY await before the credential prompt: Safari
 * grants a transient user-activation window from the triggering gesture, and
 * slow work here would spend it and silently kill the sheet.
 *
 * A genuine failure — no enrolled passkey on this device, a denied verify —
 * falls back to the GitHub server action, so the door keeps working on every
 * device for the whole migration (the fallback, and GitHub with it, is removed
 * once passkeys are verified everywhere). But a user CANCELLING the sheet
 * (NotAllowedError/AbortError) closes silently: an accidental 5-tap must not
 * escalate into a GitHub redirect, which would advertise the door louder than
 * the cancel that was meant to dismiss it (ADR 0022).
 */
const DISMISS = new Set(["NotAllowedError", "AbortError"]);

/** True when the ceremony ended because the user closed the sheet, not failed. */
function isDismissal(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (DISMISS.has(err.name)) return true;
  return err.cause instanceof Error && DISMISS.has(err.cause.name);
}

export function PasskeyDoor({ fallback }: { fallback: () => Promise<void> }) {
  const busy = useRef(false); // the 5-tap can fire twice; drop re-entries

  async function open(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await fetch("/api/auth/webauthn/auth-options", {
        method: "POST",
      });
      if (!res.ok) throw new Error("options unavailable");
      const optionsJSON = await res.json();
      const assertion = await startAuthentication({ optionsJSON });
      const result = await signIn("webauthn", {
        assertion: JSON.stringify(assertion),
        redirect: false,
      });
      if (!result || result.error) throw new Error("denied");
      // Full navigation so the server re-renders the command center with the
      // fresh session cookie.
      location.assign("/");
    } catch (err) {
      // A cancelled/aborted prompt is the user dismissing the door — stay quiet.
      // Only a real failure (no passkey here, denied verify) earns the fallback.
      // startAuthentication wraps the DOMException in a WebAuthnError but keeps
      // `.name` from the cause (verified against the installed pkg); check both.
      if (isDismissal(err)) return;
      await fallback();
    } finally {
      busy.current = false;
    }
  }

  return <form id="gh-auth" hidden onSubmit={open} />;
}
