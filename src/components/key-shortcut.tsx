"use client";

import { useEffect } from "react";

// Owner convenience: a short key sequence submits the #gh-auth form. The
// sequence is compared by hash, so it lives in neither the source nor the
// shipped bundle. Only the auth callback (lib/auth.ts) actually grants access.
const SEQ_HASH =
  "24e5e1c2bbef565360c392851175f46821fc21d6725503a600353625b4c9209c";
const SEQ_LEN = 4;

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function KeyShortcut() {
  useEffect(() => {
    if (!globalThis.crypto?.subtle) return; // needs a secure context
    let buffer = "";
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't capture real typing (the ⌘K search box, any future inputs).
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (e.key.length !== 1) return; // skip Shift, Enter, arrows, etc.
      buffer = (buffer + e.key.toLowerCase()).slice(-SEQ_LEN);
      if (buffer.length < SEQ_LEN) return;
      void sha256(buffer).then((hash) => {
        if (hash !== SEQ_HASH) return;
        const form = document.getElementById("gh-auth");
        if (form instanceof HTMLFormElement) form.requestSubmit();
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
