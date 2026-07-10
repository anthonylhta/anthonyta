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
 * ANY failure — no enrolled passkey on this device, a cancelled sheet, a
 * denied verify — falls back to the GitHub server action, so the door keeps
 * working on every device for the whole migration. The fallback (and GitHub
 * with it) is removed once passkeys are verified everywhere.
 */
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
    } catch {
      await fallback();
    } finally {
      busy.current = false;
    }
  }

  return <form id="gh-auth" hidden onSubmit={open} />;
}
