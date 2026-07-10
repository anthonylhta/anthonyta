"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

/**
 * Break-glass entry — rendered on the lobby ONLY while the server sees
 * WEBAUTHN_RECOVERY=1 (src/app/page.tsx), i.e. after the owner deliberately
 * flipped the env var and redeployed. In the steady state this component is
 * not in the tree, so the no-public-login-UI invariant (ADR 0022) holds.
 * The code is single-use: the server drops its hash before the session
 * exists, and a fresh code is minted at the next enrollment.
 */
export function RecoveryDoor() {
  const [code, setCode] = useState("");
  const [denied, setDenied] = useState(false);

  async function redeem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDenied(false);
    const result = await signIn("webauthn", {
      recovery: code,
      redirect: false,
    });
    if (!result || result.error) {
      setDenied(true);
      return;
    }
    location.assign("/");
  }

  return (
    <form
      onSubmit={redeem}
      className="flex items-center gap-2 border-b border-hairline px-4 py-3 text-xs"
    >
      <label htmlFor="recovery-code" className="text-muted">
        <span className="text-amber">&gt;</span> recovery code:
      </label>
      <input
        id="recovery-code"
        type="password"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="off"
        className="w-40 border border-hairline bg-surface px-2 py-1 font-mono text-fg outline-none focus:border-amber"
      />
      <button
        type="submit"
        className="text-muted transition-colors hover:text-amber"
      >
        redeem
      </button>
      {denied ? <span className="text-muted">denied</span> : null}
    </form>
  );
}
