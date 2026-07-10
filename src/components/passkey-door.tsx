"use client";

import { useRef } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { signIn } from "next-auth/react";

/**
 * The hidden door, WebAuthn edition. Renders the same invisible #gh-auth form
 * the secret keystroke (key-shortcut.tsx) and the lobby 5-tap (Prompt.tsx)
 * requestSubmit() — but submit runs the passkey ceremony in-page: one fast
 * same-origin fetch for options, then navigator.credentials.get via
 * startAuthentication, then the assertion through Auth.js. No redirect, no
 * third-party hop for a network observer to see (ADR 0022).
 *
 * The options fetch is the ONLY await before the credential prompt: Safari
 * grants a transient user-activation window from the triggering gesture, and
 * slow work here would spend it and silently kill the sheet.
 *
 * ANY failure — a cancelled sheet, no passkey on this device, a denied verify —
 * simply closes the door with nothing visible. Passkeys are the only way in now
 * (ADR 0057 removed the GitHub fallback); the sole break-glass is the env-gated
 * recovery form, deliberately not reachable from here.
 */
export function PasskeyDoor() {
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
    } catch {
      // Hidden door: a failed or cancelled ceremony leaves no trace.
    } finally {
      busy.current = false;
    }
  }

  return <form id="gh-auth" hidden onSubmit={open} />;
}
