"use client";

import { useSyncExternalStore } from "react";
import { toB64url } from "@/lib/crypto";
import { PRF_SALT } from "@/lib/prf";

/**
 * prfCeremony — the thin, side-effect-isolated wrapper around the raw WebAuthn
 * PRF call (ADR: PRF unlock). Every non-ceremony step (key derivation, wrapping,
 * the store round-trips) lives in unit-tested pure modules; this is the ONE piece
 * that needs a real authenticator, so it's kept minimal and behind a single
 * feature-detecting entry point. CI has no authenticator, so nothing here runs
 * under test — callers treat `null` (unsupported / cancelled / no PRF output) the
 * same as any other "passkey unlock unavailable, use the passphrase".
 *
 * No network before `navigator.credentials.get`: the challenge is random (this
 * assertion is never verified server-side — only the local PRF output matters),
 * so the browser's transient user-activation window from the triggering gesture
 * is spent on the credential prompt, not on a fetch that would silently kill it.
 */

export interface PrfResult {
  /** base64url credential id — the key into the stored wrap set. */
  credentialIdB64: string;
  /** The authenticator's 32-byte PRF secret, evaluated at `PRF_SALT`. */
  secret: Uint8Array;
}

function toBytes(src: BufferSource): Uint8Array {
  return src instanceof ArrayBuffer
    ? new Uint8Array(src)
    : new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
}

/** True when this browser can even attempt the ceremony (gates the affordance). */
export function prfCeremonySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.credentials
  );
}

const noop = () => () => {};

/**
 * The capability probe as a hook: `false` on the server and the first client
 * paint, then the real value — via `useSyncExternalStore` so it never triggers a
 * hydration mismatch or a setState-in-effect (the InstallPrompt pattern).
 */
export function usePrfCeremonySupported(): boolean {
  return useSyncExternalStore(noop, prfCeremonySupported, () => false);
}

/**
 * Run the PRF ceremony: prompt for any discoverable passkey, evaluating its PRF
 * at the fixed salt. Returns the credential id + 32-byte secret, or `null` when
 * the platform lacks WebAuthn/PRF, the user cancels, or the authenticator
 * returns no PRF output. Never throws — a failed ceremony must fall back to the
 * passphrase, not surface an error path.
 */
export async function runPrfCeremony(): Promise<PrfResult | null> {
  if (!prfCeremonySupported()) return null;
  try {
    const cred = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        userVerification: "required",
        allowCredentials: [],
        extensions: { prf: { eval: { first: PRF_SALT as BufferSource } } },
      },
    })) as PublicKeyCredential | null;
    if (!cred) return null;

    const first = cred.getClientExtensionResults().prf?.results?.first;
    if (!first) return null;
    const secret = toBytes(first);
    if (secret.length < 32) return null;

    return { credentialIdB64: toB64url(new Uint8Array(cred.rawId)), secret };
  } catch {
    return null;
  }
}
