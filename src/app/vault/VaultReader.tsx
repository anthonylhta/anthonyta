"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useVault, type Vault } from "@/app/files/useVault";
import { bumpSeenEpoch, getSeenEpoch } from "@/lib/keycache";
import { hashBytes, isManifest } from "@/lib/merkle";
import {
  isVaultIndex,
  VAULT_INDEX_PATH,
  VAULT_MANIFEST_PATH,
  type VaultIndexNote,
} from "@/lib/vaultblob";
import { checkVaultIntegrity, type IntegrityResult } from "@/lib/vaultverify";
import { VaultList } from "./VaultList";
import { VaultSearch } from "./VaultSearch";

/** The integrity line's states: pending (null), no manifest yet (a store that
 *  predates the feature — trusted, nudged), unreachable/undecryptable manifest,
 *  or the real verdict from `checkVaultIntegrity`. */
type IntegrityView =
  | IntegrityResult
  | { status: "absent" | "unchecked" }
  | null;

// Shared input/button idioms, lifted from FinPanel's LockedPanel.
const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

const UNREACHABLE = "vault unreachable — reload to retry";
const TAMPER = "cannot decrypt — lock and unlock";

/**
 * The E2EE vault index as a client island — the note sidebar behind the same master
 * key the files vault owns (one setup flow, one MK). The server only ever streams the
 * sealed `vault/index` envelope; it decrypts here, on the client, while the vault is
 * unlocked, then feeds the pure `<VaultList>`. Every miss — offline, locked, a
 * fetch/decrypt hiccup — degrades to a banner, never a blank or pretend-empty index
 * (the absent≠error rule): a healthy 404 is "no notes yet", but a network/store flake
 * is the unreachable banner.
 */
export function VaultReader({ offline }: { offline: boolean }) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  // Decrypted index (unlocked only). null = still fetching/decrypting; [] = a clean
  // 404 or a decrypted-but-empty index; non-empty = the list.
  const [notes, setNotes] = useState<VaultIndexNote[] | null>(null);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityView>(null);

  // Render-phase adjustment (not an effect): drop the decrypted index on the
  // lock/unlock edge, per FinPanel's lint-blessed reset pattern.
  const [prevUnlocked, setPrevUnlocked] = useState(unlocked);
  if (prevUnlocked !== unlocked) {
    setPrevUnlocked(unlocked);
    setNotes(null);
    setDataErr(null);
    setIntegrity(null);
  }

  // Fetch + decrypt once per unlock. A cancelled flag drops a late resolve after
  // lock/unmount. `openItem` is a stable callback, so [unlocked, openItem] fires
  // exactly on the lock→unlock edge.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    (async () => {
      // A network throw must never read as an empty (re-syncable) index — bail to
      // the unreachable banner, only a healthy 404 → "no notes yet". The manifest
      // rides the same round-trip; ITS failures only ever degrade the integrity
      // line, never the list.
      let res: Response;
      let manRes: Response | null;
      try {
        [res, manRes] = await Promise.all([
          fetch("/api/vault/raw?p=" + encodeURIComponent(VAULT_INDEX_PATH)),
          fetch(
            "/api/vault/raw?p=" + encodeURIComponent(VAULT_MANIFEST_PATH),
          ).catch(() => null),
        ]);
      } catch {
        if (!cancelled) setDataErr("unreachable");
        return;
      }
      if (res.status === 404) {
        if (!cancelled) setNotes([]);
        return;
      }
      if (res.status !== 200) {
        if (!cancelled) setDataErr("unreachable");
        return;
      }
      try {
        const buf = new Uint8Array(await res.arrayBuffer());
        const { bytes } = await openItem(buf);
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!isVaultIndex(parsed)) throw new Error("bad shape");
        if (cancelled) return;
        setNotes(parsed.notes);

        // Integrity verdict (ADR: integrity manifest). 404 = a store that
        // predates the manifest — trusted, with a re-sync nudge; an unreachable
        // or undecryptable manifest is "unchecked"/alarm, but NEVER hides the
        // notes: detection informs, the owner decides.
        if (manRes === null || (manRes.status !== 200 && manRes.status !== 404))
          return setIntegrity({ status: "unchecked" });
        if (manRes.status === 404) return setIntegrity({ status: "absent" });
        try {
          const opened = await openItem(
            new Uint8Array(await manRes.arrayBuffer()),
          );
          const man: unknown = JSON.parse(
            new TextDecoder().decode(opened.bytes),
          );
          if (!isManifest(man)) throw new Error("bad manifest");
          const result = await checkVaultIntegrity({
            manifest: man,
            index: parsed,
            indexEnvelopeHash: await hashBytes(buf),
            seenEpoch: await getSeenEpoch(),
          });
          if (cancelled) return;
          if (result.status === "verified") await bumpSeenEpoch(result.epoch);
          setIntegrity(result);
        } catch {
          if (!cancelled)
            setIntegrity({
              status: "alarm",
              epoch: 0,
              problems: [
                "the integrity manifest cannot be decrypted or parsed — re-run vault-sync, and treat an unexplained recurrence as tampering",
              ],
            });
        }
      } catch {
        if (!cancelled) setDataErr("tamper");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  // --- non-unlocked states ---
  if (vault.status === "offline")
    return <Notice>store offline — set the R2_* env vars</Notice>;
  if (vault.status === "setup")
    return (
      <Notice>
        set a vault passphrase in{" "}
        <Link href="/files" className="text-amber hover:underline">
          files/
        </Link>{" "}
        first
      </Notice>
    );
  if (vault.status === "locked") return <UnlockBox vault={vault} />;
  if (vault.status === "error")
    return <Notice tone="down">{UNREACHABLE}</Notice>;
  if (vault.status === "loading") return <Notice>loading…</Notice>;

  // --- unlocked: a data error, the still-decrypting gap, empty, or the list ---
  if (dataErr)
    return (
      <Notice tone="down">
        {dataErr === "unreachable" ? UNREACHABLE : TAMPER}
      </Notice>
    );
  if (notes === null) return <Notice>decrypting…</Notice>;
  if (notes.length === 0)
    return <Notice>no notes synced yet — run npm run vault-sync</Notice>;

  return (
    <>
      <IntegrityLine view={integrity} />
      <VaultSearch openItem={openItem} notes={notes} />
      <VaultList notes={notes} />
    </>
  );
}

/**
 * The integrity verdict, above the list. Verified/absent/unchecked are one muted
 * line; an alarm is a loud bordered block that NAMES each finding — but the list
 * still renders below it. Detection only, never auto-repair: hiding the notes
 * would punish the owner for looking, and repair is a separate trust decision.
 */
function IntegrityLine({ view }: { view: IntegrityView }) {
  if (view === null) return null;
  if (view.status === "alarm")
    return (
      <div className="mx-4 mt-3 border border-down/60 px-3 py-2 text-xs text-down">
        <p className="font-semibold uppercase tracking-[0.15em]">
          integrity alarm
        </p>
        <ul className="mt-1 list-disc pl-4">
          {view.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="mt-1 text-down/80">
          nothing was repaired — verify against your local vault + backups
        </p>
      </div>
    );
  return (
    <p className="px-4 pt-3 text-[11px] text-muted">
      integrity:{" "}
      {view.status === "verified" ? (
        <>
          <span className="text-up">verified</span> · epoch {view.epoch}
        </>
      ) : view.status === "absent" ? (
        "no manifest yet — run npm run vault-sync"
      ) : (
        "unverified — manifest unreachable"
      )}
    </p>
  );
}

/** A centered status line in the content region, matching the old empty state. */
function Notice({ children, tone }: { children: ReactNode; tone?: "down" }) {
  return (
    <p
      className={`px-4 py-10 text-center text-sm ${
        tone === "down" ? "text-down" : "text-muted"
      }`}
    >
      {children}
    </p>
  );
}

/** Locked: an inline passphrase prompt reusing the one MK (FinPanel's UnlockBox). */
function UnlockBox({ vault }: { vault: Vault }) {
  const [pass, setPass] = useState("");

  async function submit() {
    if (!pass || vault.working) return;
    await vault.unlock(pass);
    setPass("");
  }

  return (
    <div className="px-4 py-4 text-xs">
      <p className="mb-2 text-muted">
        vault <span className="text-amber">locked</span> — enter the passphrase
        to reveal the note index.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={pass}
          disabled={vault.working}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="passphrase"
          className={`flex-1 ${input}`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={vault.working || !pass}
          className={btn}
        >
          {vault.working ? "deriving key…" : "unlock"}
        </button>
      </div>
      {vault.error && <p className="mt-2 text-down">{vault.error}</p>}
    </div>
  );
}
