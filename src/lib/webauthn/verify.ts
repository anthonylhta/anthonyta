import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { fromB64url } from "@/lib/crypto";
import { challengeFromCookieHeader, openChallenge } from "./cookie";
import {
  isWebauthnRecord,
  withCounter,
  withoutRecovery,
  type WebauthnCred,
} from "./record";
import { matchesRecoveryHash } from "./recovery";
import { rpConfig } from "./rp";
import { getWebauthnRecord, putWebauthnRecord } from "./store";

const MAX_ASSERTION_BYTES = 10_240;

export interface DoorUser {
  id: "owner";
  name: string;
}

/**
 * The hidden door's verdict — the `authorize` core of the webauthn Credentials
 * provider. Returns the single owner user or null; Auth.js turns null into a
 * silent 302 back to the lobby (pages.error = "/"), so a failed ceremony looks
 * exactly like nothing happened. Every deny path is deliberately quiet: this
 * runs unauthenticated, and detail here would advertise the door (ADR 0022).
 *
 * Two ways in:
 *  - `assertion`: a WebAuthn authentication response, checked against the
 *    challenge from the signed single-use cookie and the credential record at
 *    meta/webauthn.
 *  - `recovery`: the one-time break-glass code — honored ONLY while the
 *    WEBAUTHN_RECOVERY env flag is set (a deliberate redeploy by the owner,
 *    who controls Vercel env), consumed on success BEFORE the session exists,
 *    and denied outright if the consuming write fails: a transient blob error
 *    must not leave a reusable "one-time" code.
 */
export async function verifyDoor(
  credentials: Partial<Record<"assertion" | "recovery", unknown>>,
  request: Request,
): Promise<DoorUser | null> {
  try {
    if (typeof credentials.recovery === "string") {
      return await verifyRecovery(credentials.recovery);
    }
    return await verifyAssertion(credentials.assertion, request);
  } catch (err) {
    console.error("[webauthn] door verify failed:", err);
    return null;
  }
}

const owner = (): DoorUser => ({
  id: "owner",
  name: process.env.OWNER_GITHUB_LOGIN ?? "anthony",
});

async function verifyAssertion(
  assertion: unknown,
  request: Request,
): Promise<DoorUser | null> {
  if (typeof assertion !== "string" || assertion.length > MAX_ASSERTION_BYTES)
    return null;

  const sealed = challengeFromCookieHeader(request.headers.get("cookie"));
  const challenge = sealed
    ? openChallenge(sealed, "auth", process.env.AUTH_SECRET ?? "")
    : null;
  if (!challenge) return null;

  const parsed: unknown = JSON.parse(assertion);
  if (typeof parsed !== "object" || parsed === null) return null;
  const response = parsed as AuthenticationResponseJSON;
  if (typeof response.id !== "string" || response.id.length === 0) return null;

  const read = await getWebauthnRecord();
  if (read.state !== "ok") return null;
  const record: unknown = JSON.parse(read.value);
  if (!isWebauthnRecord(record)) return null;

  const cred = record.creds.find((c: WebauthnCred) => c.id === response.id);
  if (!cred) return null;

  const rp = rpConfig();
  const { verified, authenticationInfo } = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origins,
    expectedRPID: rp.rpID,
    credential: {
      id: cred.id,
      // re-wrapped so the type is Uint8Array<ArrayBuffer>, which the verifier pins
      publicKey: new Uint8Array(fromB64url(cred.pk)),
      counter: cred.counter,
      transports: cred.transports as WebAuthnTransports,
    },
    requireUserVerification: true,
  });
  if (!verified) return null;

  // Stamp the sign-in — and advance the counter when it moved — in ONE
  // best-effort write. The stamp lands on EVERY successful assertion, not only
  // when the counter advances: synced passkeys (iCloud Keychain, Google Password
  // Manager) report 0 forever, so gating the write on the counter would never
  // record a sign-in for a phone credential — the exact device the "last sign-in"
  // line exists to surface. Counter stays telemetry, never a gate: take the max
  // so a 0 or regressed report never rolls it back and reads as a cloned
  // authenticator (that "protection" would only ever lock the owner out).
  const nextCounter = Math.max(cred.counter, authenticationInfo.newCounter);
  const stamped = withCounter(
    record,
    cred.id,
    nextCounter,
    new Date().toISOString(),
  );
  const wrote = await putWebauthnRecord(JSON.stringify(stamped), true);
  if (wrote !== "ok") console.error("[webauthn] sign-in stamp failed");

  return owner();
}

async function verifyRecovery(code: string): Promise<DoorUser | null> {
  if (process.env.WEBAUTHN_RECOVERY !== "1") return null;
  if (code.length === 0 || code.length > 128) return null;

  const read = await getWebauthnRecord();
  if (read.state !== "ok") return null;
  const record: unknown = JSON.parse(read.value);
  if (!isWebauthnRecord(record) || !record.recovery) return null;

  if (!matchesRecoveryHash(code, record.recovery.hash_b64)) return null;

  // Single-use: drop the hash BEFORE returning a session. If this write
  // fails, deny — a blob hiccup must not turn "one-time" into "reusable".
  const consumed = await putWebauthnRecord(
    JSON.stringify(withoutRecovery(record)),
    true,
  );
  if (consumed !== "ok") return null;

  return owner();
}

type WebAuthnTransports = Parameters<
  typeof verifyAuthenticationResponse
>[0]["credential"]["transports"];
