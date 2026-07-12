"use client";

import { useCallback, useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import {
  deriveKek,
  fromB64url,
  isKeystore,
  toB64url,
  unwrapMk,
  wrapMk,
  type Keystore,
} from "@/lib/crypto";
import {
  deriveKekFromPrf,
  isPrfWrapSet,
  removeWrap,
  upsertWrap,
  type PrfWrap,
  type PrfWrapSet,
} from "@/lib/prf";
import {
  runPrfCeremony,
  usePrfCeremonySupported,
} from "@/app/files/prfCeremony";

/**
 * Passkey enrollment — owner-side only (rendered inside the command center,
 * which guests never see). Drives the owner-gated register-options /
 * register-verify pair; the FIRST enrollment comes back with the one-time
 * recovery code, shown here exactly once and never again — the server keeps
 * only its hash.
 *
 * It also hosts vault PRF unlock (ADR: PRF unlock): enrolling a passkey to open
 * the E2EE vault with a biometric tap. That is a SECOND wrapping of the master
 * key under a passkey-derived KEK, added ON TOP of the passphrase — the
 * passphrase wrap is never touched, so revoking every passkey here only drops
 * convenience, never the vault.
 */
export function PasskeyManager() {
  return (
    <>
      <PasskeyEnroll />
      <VaultUnlockManager />
    </>
  );
}

// ---------------------------------------------------------------------------
// passkey sign-in enrollment (unchanged behaviour)
// ---------------------------------------------------------------------------

function PasskeyEnroll() {
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

// ---------------------------------------------------------------------------
// vault PRF unlock — enroll a device, list the enrolled wraps, revoke one
// ---------------------------------------------------------------------------

/** The current wrap set, or empty on a genuine 404. Throws on any other failure
 *  so a flaky read never lets an upsert/remove PUT clobber other devices' wraps. */
async function fetchWrapSet(): Promise<PrfWrapSet> {
  const res = await fetch("/api/prf/wrap");
  if (res.status === 404) return { v: 1, wraps: [] };
  if (!res.ok) throw new Error("wrap set unavailable");
  const parsed: unknown = await res.json();
  if (!isPrfWrapSet(parsed)) throw new Error("wrap set malformed");
  return parsed;
}

async function putWrapSet(set: PrfWrapSet): Promise<boolean> {
  const res = await fetch("/api/prf/wrap", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(set),
  });
  return res.ok;
}

async function fetchKeystore(): Promise<Keystore | null> {
  const res = await fetch("/api/files/keystore");
  if (!res.ok) return null;
  const parsed: unknown = await res.json();
  return isKeystore(parsed) ? parsed : null;
}

type EnrollState = "idle" | "busy" | "done" | "badpass" | "failed";

/** A short, human device name for the enrolled passkey — the platform where
 *  available, lowercased and bounded. Purely cosmetic; never trusted. */
function deviceLabel(): string {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const raw = nav.userAgentData?.platform || navigator.platform || "device";
  return raw.toLowerCase().slice(0, 64);
}

function VaultUnlockManager() {
  const [wraps, setWraps] = useState<PrfWrap[] | null>(null);
  const [pass, setPass] = useState("");
  const [enroll, setEnroll] = useState<EnrollState>("idle");
  const capable = usePrfCeremonySupported();

  // Read the current wraps for the list. A genuine 404 is "none enrolled" ([]);
  // any hiccup stays `null` so the UI never claims "none" on a flake. Returns the
  // wraps so callers can refresh after a mutation without a second round-trip.
  const loadWraps = useCallback(async (): Promise<PrfWrap[] | null> => {
    try {
      const res = await fetch("/api/prf/wrap");
      if (res.status === 404) return [];
      if (!res.ok) return null;
      const parsed: unknown = await res.json();
      return isPrfWrapSet(parsed) ? parsed.wraps : [];
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await loadWraps();
      if (!cancelled) setWraps(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadWraps]);

  async function enable() {
    if (enroll === "busy" || !pass) return;
    setEnroll("busy");
    try {
      const ks = await fetchKeystore();
      if (!ks) {
        setEnroll("failed");
        return;
      }
      const kek = await deriveKek(
        pass,
        fromB64url(ks.kdf.salt_b64),
        ks.kdf.iterations,
      );
      // Re-derive an EXTRACTABLE master key — the only way to re-wrap it (WebCrypto
      // refuses to wrap a non-extractable key), exactly as changePassphrase does. A
      // wrong passphrase fails this unwrap's GCM auth check.
      let extractableMk: CryptoKey;
      try {
        extractableMk = await unwrapMk(
          fromB64url(ks.wrapped_mk_b64),
          fromB64url(ks.iv_b64),
          kek,
          true,
        );
      } catch {
        setEnroll("badpass");
        return;
      }
      const prf = await runPrfCeremony();
      if (!prf) {
        setEnroll("failed");
        return;
      }
      const prfKek = await deriveKekFromPrf(prf.secret);
      const { wrapped, iv } = await wrapMk(extractableMk, prfKek);
      // The extractable handle has served its one purpose — drop it now.
      extractableMk = undefined as unknown as CryptoKey;
      const wrap: PrfWrap = {
        v: 1,
        credential_id_b64: prf.credentialIdB64,
        wrapped_mk_b64: toB64url(wrapped),
        iv_b64: toB64url(iv),
        label: deviceLabel(),
      };
      // Read-modify-write: add this device's wrap without disturbing the others.
      const set = await fetchWrapSet();
      if (!(await putWrapSet(upsertWrap(set, wrap)))) {
        setEnroll("failed");
        return;
      }
      setPass("");
      setEnroll("done");
      setWraps(await loadWraps());
    } catch {
      setEnroll("failed");
    }
  }

  async function revoke(credId: string) {
    try {
      const set = await fetchWrapSet();
      if (await putWrapSet(removeWrap(set, credId)))
        setWraps(await loadWraps());
    } catch {
      // leave the list as-is; the passphrase always still opens the vault
    }
  }

  const status =
    enroll === "busy"
      ? "enabling…"
      : enroll === "done"
        ? "passkey unlock on ✓"
        : enroll === "badpass"
          ? "wrong passphrase"
          : enroll === "failed"
            ? "couldn't enable"
            : null;

  const input =
    "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";

  return (
    <div className="border-b border-hairline px-4 py-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted">
          vault unlock{status ? <span className="ml-2">· {status}</span> : null}
        </span>
      </div>

      {wraps && wraps.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {wraps.map((w, i) => (
            <li
              key={w.credential_id_b64}
              className="flex items-center justify-between"
            >
              <span className="text-fg">
                {w.label ?? `passkey ${i + 1}`}
                <span className="ml-2 font-mono text-muted">
                  #{w.credential_id_b64.slice(0, 6)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => revoke(w.credential_id_b64)}
                className="text-muted transition-colors hover:text-down"
              >
                revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {capable ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="password"
            value={pass}
            disabled={enroll === "busy"}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enable()}
            placeholder="passphrase — enable on this device"
            className={`flex-1 ${input}`}
          />
          <button
            type="button"
            onClick={enable}
            disabled={enroll === "busy" || !pass}
            className="border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30"
          >
            enable
          </button>
        </div>
      ) : (
        <p className="mt-2 text-muted/60">
          this device can&apos;t use a passkey to unlock — the passphrase stays.
        </p>
      )}
    </div>
  );
}
