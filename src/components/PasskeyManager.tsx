"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

/**
 * Passkey enrollment — owner-side only (rendered inside the command center,
 * which guests never see). Drives the owner-gated register-options /
 * register-verify pair; the FIRST enrollment comes back with the one-time
 * recovery code, shown here exactly once and never again — the server keeps
 * only its hash.
 */
export function PasskeyManager() {
  const [state, setState] = useState<
    "idle" | "busy" | "done" | "failed" | "unavailable"
  >("idle");
  const [recovery, setRecovery] = useState<string | null>(null);

  async function enroll() {
    if (state === "busy") return;
    setState("busy");
    try {
      const optRes = await fetch("/api/auth/webauthn/register-options", {
        method: "POST",
      });
      if (!optRes.ok) {
        setState(optRes.status === 503 ? "unavailable" : "failed");
        return;
      }
      const optionsJSON = await optRes.json();
      const response = await startRegistration({ optionsJSON });
      const verifyRes = await fetch("/api/auth/webauthn/register-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          response,
          label: navigator.platform?.toLowerCase() || "device",
        }),
      });
      if (!verifyRes.ok) {
        setState(verifyRes.status === 503 ? "unavailable" : "failed");
        return;
      }
      const body = (await verifyRes.json()) as { recovery?: string };
      if (body.recovery) setRecovery(body.recovery);
      setState("done");
    } catch {
      // user cancel, no authenticator, verify failure — all the same shrug
      setState("failed");
    }
  }

  const status =
    state === "busy"
      ? "enrolling…"
      : state === "done"
        ? "passkey added ✓"
        : state === "failed"
          ? "enroll failed"
          : state === "unavailable"
            ? "store unavailable"
            : null;

  return (
    <>
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
        <span className="text-muted">
          passkeys{status ? <span className="ml-2">· {status}</span> : null}
        </span>
        <button
          type="button"
          onClick={enroll}
          disabled={state === "busy"}
          className="text-muted transition-colors hover:text-amber disabled:opacity-50"
        >
          add passkey
        </button>
      </div>
      {recovery ? (
        <div className="border-b border-hairline px-4 py-3 text-xs">
          <p className="text-muted">
            recovery code — shown once, keep it offline:
          </p>
          <p className="mt-1 font-mono tabular-nums text-amber">{recovery}</p>
          <button
            type="button"
            onClick={() => setRecovery(null)}
            className="mt-2 text-muted transition-colors hover:text-amber"
          >
            dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}
