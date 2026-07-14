"use client";

/**
 * RecoveryShares — Shamir paper recovery for the vault master key (PR #71). Two
 * flows, both entirely client-side; a share never touches the network.
 *
 * SETUP re-derives the MK from the passphrase (the running vault holds it
 * non-extractably, so re-deriving is the only honest way to raw bytes): unwrap it
 * extractably, export the 32 raw bytes, `split` them into n printed shares, and
 * zero the raw bytes immediately. The shares exist only on paper/screen.
 *
 * RECOVER (reachable when the passphrase is lost and the vault is locked) rebuilds
 * the MK from k pasted shares, then — before anything destructive — VERIFIES it by
 * opening an existing master-key-sealed envelope. A wrong reconstruction fails that
 * GCM tag and aborts; only a verified key earns the one legitimate keystore
 * overwrite (recovery implies the old passphrase is gone).
 */

import { useRef, useState } from "react";
import {
  buildKeystore,
  deriveKek,
  fromB64url,
  isKeystore,
  ITERATIONS,
  open,
  randomSalt,
  sealCanary,
  wrapMk,
  type Keystore,
} from "@/lib/crypto";
import { reconstructSecret } from "@/lib/recovery";
import { formatShare, split } from "@/lib/shamir";
import { VAULT_INDEX_PATH } from "@/lib/vaultblob";

const MK_BYTES = 32;

const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const primaryBtn =
  "self-start border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

/** Today as YYYY-MM-DD in Sydney — the date printed on each share. */
function todayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// setup — create recovery shares from the passphrase
// ---------------------------------------------------------------------------

interface SharesReady {
  payloads: string[];
  n: number;
  k: number;
  date: string;
}

/**
 * Owner-side setup, mounted in the command center. Re-derives the MK from the
 * passphrase, splits it, and hands back a print view. `offline` (store off) or an
 * absent keystore both degrade to a disabled note rather than a crash.
 */
export function RecoveryShares({ offline }: { offline: boolean }) {
  const [open_, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [n, setN] = useState(5);
  const [k, setK] = useState(3);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<SharesReady | null>(null);

  async function create() {
    if (working || offline) return;
    if (k < 2 || n < k || n > 20) {
      setError("pick a threshold of 2+ and at most 20 shares");
      return;
    }
    setWorking(true);
    setError(null);
    let raw: Uint8Array | null = null;
    try {
      const res = await fetch("/api/files/keystore");
      if (res.status === 404) {
        setError("no vault yet — create one in files/ first");
        return;
      }
      if (!res.ok) {
        setError("keystore unavailable — try again");
        return;
      }
      const parsed: unknown = await res.json();
      if (!isKeystore(parsed)) {
        setError("keystore looks malformed");
        return;
      }
      const ks = parsed as Keystore;
      const kek = await deriveKek(
        pass,
        fromB64url(ks.kdf.salt_b64),
        ks.kdf.iterations,
      );
      // Momentarily-extractable unwrap — the only honest path to raw bytes. A
      // wrong passphrase fails this GCM check and throws.
      const mk = await unwrapExtractable(ks, kek);
      raw = new Uint8Array(await crypto.subtle.exportKey("raw", mk));
      const shares = split(raw, n, k);
      const payloads = shares.map((s) => formatShare(s, k));
      setReady({ payloads, n, k, date: todayISO() });
      setPass("");
    } catch {
      setError("wrong passphrase");
    } finally {
      // The raw master key never outlives this function.
      if (raw) raw.fill(0);
      setWorking(false);
    }
  }

  function reset() {
    setReady(null);
    setError(null);
    setPass("");
  }

  if (offline) {
    return (
      <Strip>
        <span className="text-muted">
          recovery shares · <span className="text-muted/60">store offline</span>
        </span>
      </Strip>
    );
  }

  if (ready) {
    return <PrintView data={ready} onDone={reset} />;
  }

  return (
    <>
      <Strip>
        <span className="text-muted">recovery shares</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted transition-colors hover:text-amber"
        >
          {open_ ? "close" : "create shares"}
        </button>
      </Strip>
      {open_ && (
        <div className="border-b border-hairline px-4 py-3 text-xs">
          <p className="mb-2 text-muted">
            split the master key into printed shares — any{" "}
            <span className="text-amber">{k}</span> of{" "}
            <span className="text-amber">{n}</span> restore it if the passphrase
            is ever lost. re-enter the passphrase to derive the key on this
            device.
          </p>
          <div className="flex flex-col gap-2">
            <input
              type="password"
              value={pass}
              disabled={working}
              onChange={(e) => setPass(e.target.value)}
              placeholder="vault passphrase"
              className={input}
            />
            <div className="flex items-center gap-4 text-muted">
              <label className="flex items-center gap-2">
                shares
                <select
                  value={n}
                  disabled={working}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setN(next);
                    // keep the threshold a valid k ≤ n as the count shrinks.
                    if (k > next) setK(next);
                  }}
                  className={`${input} py-0.5`}
                >
                  {[3, 4, 5, 6, 7, 8].map((v) => (
                    <option key={v} value={v} className="bg-surface">
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                threshold
                <select
                  value={k}
                  disabled={working}
                  onChange={(e) => setK(Number(e.target.value))}
                  className={`${input} py-0.5`}
                >
                  {Array.from({ length: n - 1 }, (_, i) => i + 2).map((v) => (
                    <option key={v} value={v} className="bg-surface">
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={create}
              disabled={working || !pass}
              className={primaryBtn}
            >
              {working ? "deriving key…" : "create shares"}
            </button>
            {error && <p className="text-down">{error}</p>}
            <p className="text-muted/60">
              shares are shown once and never stored — print them now and keep
              them apart.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/** Extractable unwrap of the stored MK — mirrors changePassphrase's momentary handle. */
function unwrapExtractable(ks: Keystore, kek: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    fromB64url(ks.wrapped_mk_b64) as BufferSource,
    kek,
    { name: "AES-GCM", iv: fromB64url(ks.iv_b64) as BufferSource },
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  ) as Promise<CryptoKey>;
}

// ---------------------------------------------------------------------------
// print view — one share per page
// ---------------------------------------------------------------------------

function PrintView({
  data,
  onDone,
}: {
  data: SharesReady;
  onDone: () => void;
}) {
  const { payloads, n, k, date } = data;
  return (
    <div className="border-b border-hairline px-4 py-3 text-xs">
      <div className="mb-3 flex items-center justify-between print:hidden">
        <span className="text-muted">
          <span className="text-amber">{n}</span> shares · any{" "}
          <span className="text-amber">{k}</span> restore the vault
        </span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            className="text-muted transition-colors hover:text-amber"
          >
            print
          </button>
          <button
            type="button"
            onClick={onDone}
            className="text-muted transition-colors hover:text-amber"
          >
            done
          </button>
        </span>
      </div>

      <p className="mb-3 text-down/80 print:hidden">
        these are shown once and never stored. print now, then store each share
        in a separate place. anyone with <span className="text-amber">{k}</span>{" "}
        can unlock the vault.
      </p>

      <div data-print-root>
        {payloads.map((payload, i) => (
          <section
            key={i}
            className="print-share mb-3 border border-hairline px-3 py-3 print:mb-0 print:border-0"
          >
            <div className="flex items-baseline justify-between">
              <span className="uppercase tracking-[0.18em] text-muted">
                vault recovery share {i + 1} of {n}
              </span>
              <span className="tabular-nums text-muted">{date}</span>
            </div>
            <p className="mt-1 text-muted">
              any {k} of {n} shares restore the master key.
            </p>
            <pre className="mt-3 font-mono text-[13px] break-all whitespace-pre-wrap text-fg select-all">
              {payload}
            </pre>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// recover — rebuild + verify + re-wrap, reachable when locked
// ---------------------------------------------------------------------------

type RecoverPhase =
  /** collecting pasted shares */
  | "input"
  /** verified against a sealed envelope — waiting on a new passphrase */
  | "verified"
  /** nothing sealed under the MK to verify against — needs explicit go-ahead */
  | "no-target"
  /** keystore re-written — reload to unlock with the new passphrase */
  | "done";

/**
 * Locked-state recovery panel. The reconstructed key is held (extractably, so it
 * can be re-wrapped) in a ref only between a successful verify and the re-wrap; it
 * is never cached and never leaves this component.
 */
export function RecoverWithShares() {
  const [open_, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<RecoverPhase>("input");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const mkRef = useRef<CryptoKey | null>(null);

  function forget() {
    mkRef.current = null;
    setText("");
    setNewPass("");
    setNewPass2("");
  }

  async function reconstructAndVerify() {
    if (working) return;
    setWorking(true);
    setError(null);
    let secret: Uint8Array | null = null;
    try {
      const result = reconstructSecret(text.split(/\r?\n/));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      secret = result.secret;
      if (secret.length !== MK_BYTES) {
        setError("reconstructed key is the wrong size");
        return;
      }
      // Import extractable so a verified key can be re-wrapped without a second
      // reconstruction; usages cover both the open() check and the later wrap.
      const mk = (await crypto.subtle.importKey(
        "raw",
        secret as BufferSource,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"],
      )) as CryptoKey;

      const target = await fetchVerifyEnvelope();
      if (target.kind === "error") {
        setError("couldn't reach the vault to verify — try again");
        return;
      }
      if (target.kind === "none") {
        // Fresh vault: nothing sealed under the MK exists to prove the key is
        // right. Never blind-overwrite — require an explicit go-ahead.
        mkRef.current = mk;
        setPhase("no-target");
        return;
      }
      try {
        // The load-bearing check: a wrong reconstruction fails this GCM tag.
        await open(mk, target.bytes);
      } catch {
        setError("these shares don't reconstruct the key — check them");
        return;
      }
      mkRef.current = mk;
      setPhase("verified");
    } catch {
      setError("recovery failed — check the shares and try again");
    } finally {
      if (secret) secret.fill(0);
      setWorking(false);
    }
  }

  async function rewrap() {
    const mk = mkRef.current;
    if (!mk || working) return;
    if (!newPass) return;
    if (newPass !== newPass2) {
      setError("new passphrases don't match");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const salt = randomSalt();
      const kek = await deriveKek(newPass, salt);
      const { wrapped, iv } = await wrapMk(mk, kek);
      // Refresh the canary under the recovered MK so recovery lands a v2 keystore.
      const ks = buildKeystore(
        salt,
        ITERATIONS,
        wrapped,
        iv,
        await sealCanary(mk),
      );
      // The one legitimate overwrite: recovery means the old passphrase is gone.
      const res = await fetch("/api/files/keystore", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-keystore-overwrite": "1",
        },
        body: JSON.stringify(ks),
      });
      if (!res.ok) {
        setError("couldn't write the new keystore — try again");
        return;
      }
      forget();
      setPhase("done");
    } catch {
      setError("couldn't write the new keystore — try again");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-3 border border-hairline px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted">lost the passphrase?</span>
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            if (open_) {
              forget();
              setPhase("input");
              setError(null);
            }
          }}
          className="text-muted transition-colors hover:text-amber"
        >
          {open_ ? "close" : "recover with shares"}
        </button>
      </div>

      {open_ && phase === "input" && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-muted">
            paste your recovery shares — one per line. any threshold-many
            rebuild the key.
          </p>
          <textarea
            rows={5}
            value={text}
            disabled={working}
            onChange={(e) => setText(e.target.value)}
            placeholder="share payloads, one per line"
            className={`${input} resize-none`}
          />
          <button
            type="button"
            onClick={reconstructAndVerify}
            disabled={working || !text.trim()}
            className={primaryBtn}
          >
            {working ? "verifying…" : "reconstruct + verify"}
          </button>
          {error && <p className="text-down">{error}</p>}
        </div>
      )}

      {open_ && phase === "no-target" && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-amber">
            shares reconstructed, but nothing is sealed under this key yet to
            verify against.
          </p>
          <p className="text-muted/80">
            if this vault is empty that&apos;s expected. only continue if you
            trust these shares — a wrong set would replace the keystore.
          </p>
          <NewPass
            newPass={newPass}
            newPass2={newPass2}
            working={working}
            setNewPass={setNewPass}
            setNewPass2={setNewPass2}
            onSubmit={rewrap}
            submitLabel="overwrite keystore anyway"
          />
          {error && <p className="text-down">{error}</p>}
        </div>
      )}

      {open_ && phase === "verified" && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-up">key verified ✓ — set a new passphrase.</p>
          <NewPass
            newPass={newPass}
            newPass2={newPass2}
            working={working}
            setNewPass={setNewPass}
            setNewPass2={setNewPass2}
            onSubmit={rewrap}
            submitLabel="set passphrase + rewrap"
          />
          {error && <p className="text-down">{error}</p>}
        </div>
      )}

      {open_ && phase === "done" && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-up">
            recovery complete — reload and unlock with the new passphrase.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={primaryBtn}
          >
            reload
          </button>
        </div>
      )}
    </div>
  );
}

function NewPass({
  newPass,
  newPass2,
  working,
  setNewPass,
  setNewPass2,
  onSubmit,
  submitLabel,
}: {
  newPass: string;
  newPass2: string;
  working: boolean;
  setNewPass: (v: string) => void;
  setNewPass2: (v: string) => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <>
      <input
        type="password"
        value={newPass}
        disabled={working}
        onChange={(e) => setNewPass(e.target.value)}
        placeholder="new passphrase"
        className={input}
      />
      <input
        type="password"
        value={newPass2}
        disabled={working}
        onChange={(e) => setNewPass2(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder="new passphrase, again"
        className={input}
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={working || !newPass}
        className={primaryBtn}
      >
        {working ? "rewrapping…" : submitLabel}
      </button>
    </>
  );
}

/**
 * Fetch an envelope sealed under the MASTER key to verify a reconstruction against.
 * Prefers the fin config (sealed net worth); falls back to the vault index note.
 * "none" = neither exists (fresh vault); "error" = a transient store failure that
 * must not be mistaken for absence.
 */
async function fetchVerifyEnvelope(): Promise<
  { kind: "envelope"; bytes: Uint8Array } | { kind: "none" } | { kind: "error" }
> {
  try {
    const fin = await fetch("/api/fin/config");
    if (fin.ok)
      return {
        kind: "envelope",
        bytes: new Uint8Array(await fin.arrayBuffer()),
      };
    if (fin.status !== 404) return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
  try {
    const note = await fetch(
      `/api/vault/raw?p=${encodeURIComponent(VAULT_INDEX_PATH)}`,
    );
    if (note.ok)
      return {
        kind: "envelope",
        bytes: new Uint8Array(await note.arrayBuffer()),
      };
    if (note.status !== 404) return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
  return { kind: "none" };
}

/** The command-center strip chrome shared by the collapsed setup entry point. */
function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs">
      {children}
    </div>
  );
}
