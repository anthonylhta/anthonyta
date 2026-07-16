"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useVault, type Vault } from "@/app/files/useVault";
import { hashBytes, isManifest } from "@/lib/merkle";
import { preprocessNote } from "@/lib/vault";
import {
  isVaultIndex,
  noteBlob,
  VAULT_INDEX_PATH,
  VAULT_MANIFEST_PATH,
  type VaultIndex,
  type VaultIndexNote,
} from "@/lib/vaultblob";
import { manifestHashFor } from "@/lib/vaultverify";
import { NoteBody } from "./NoteBody";

// Input/button idioms, lifted from the FinPanel/FilesInbox unlock prompts.
const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

const UNREACHABLE =
  "vault unreachable — reload to retry (your key is untouched)";
const TAMPER = "cannot decrypt — lock and unlock";

/** Where the decrypt-and-render lives once the vault is unlocked. */
type Phase = "decrypting" | "ready" | "notfound" | "tamper" | "unreachable";

/**
 * The client half of the vault note reader (ADR: E2EE vault). The page renders the
 * owner-gated shell; everything below the fold — the index, the note body, and any
 * `![[image]]` embed — is ciphertext that only decrypts here, in the browser, while
 * the vault is unlocked. The UNCHANGED, pure `preprocessNote` runs client-side on the
 * decrypted markdown to resolve wikilinks + embeds; embedded images are separate
 * encrypted blobs the markdown body turns into object URLs (see NoteBody's VaultImg).
 */
export function NoteReader({ id, offline }: { id: string; offline: boolean }) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [phase, setPhase] = useState<Phase>("decrypting");
  const [note, setNote] = useState<VaultIndexNote | null>(null);
  const [md, setMd] = useState<string | null>(null);
  // Valid decrypt, wrong lineage: the served ciphertext doesn't match the
  // integrity manifest (e.g. substituted with its own older valid envelope).
  // Distinct from the tamper phase — the body still renders, under a banner.
  const [integrityAlarm, setIntegrityAlarm] = useState(false);

  // Render-phase reset (not an effect), per the lint-blessed pattern: on the
  // lock/unlock edge OR a navigation to a different note id, drop the decrypted
  // state so a stale body never flashes under the new key/route.
  const key = `${unlocked ? "u" : "l"}:${id}`;
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setPhase("decrypting");
    setNote(null);
    setMd(null);
    setIntegrityAlarm(false);
  }

  // Fetch + decrypt once per unlock. A cancelled flag drops a late resolve after
  // lock/unmount; `openItem` is a stable callback, so this fires on the unlock edge.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    (async () => {
      // The index (for wikilink/embed resolution + the note's title) and the note
      // envelope, together — one round-trip each.
      let idxRes: Response;
      let noteRes: Response;
      let manRes: Response | null;
      try {
        [idxRes, noteRes, manRes] = await Promise.all([
          fetch(`/api/vault/raw?p=${encodeURIComponent(VAULT_INDEX_PATH)}`),
          fetch(`/api/vault/raw?p=${encodeURIComponent(noteBlob(id))}`),
          // The manifest only ever powers the integrity banner — its failures
          // never block the note (collection-level alarms live on /vault).
          fetch(
            `/api/vault/raw?p=${encodeURIComponent(VAULT_MANIFEST_PATH)}`,
          ).catch(() => null),
        ]);
      } catch {
        if (!cancelled) setPhase("unreachable");
        return;
      }

      // A genuinely missing note isn't a hard 404 — the owner already loaded the
      // page — it's an inline "not found".
      if (noteRes.status === 404) {
        if (!cancelled) setPhase("notfound");
        return;
      }
      if (!idxRes.ok || !noteRes.ok) {
        if (!cancelled) setPhase("unreachable");
        return;
      }

      // Decrypt + shape-guard the index. A decrypt throw here is a stale cached
      // key, same as the body below → the lock/unlock nudge.
      let index: VaultIndex;
      try {
        const { bytes } = await openItem(
          new Uint8Array(await idxRes.arrayBuffer()),
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!isVaultIndex(parsed)) throw new Error("bad index");
        index = parsed;
      } catch {
        if (!cancelled) setPhase("tamper");
        return;
      }

      const entry = index.notes.find((n) => n.id === id);
      if (!entry) {
        if (!cancelled) setPhase("notfound");
        return;
      }

      // Decrypt the note body. A throw means the cached key no longer matches this
      // keystore (reset elsewhere) — lock/unlock to re-derive.
      let raw: string;
      const noteBuf = new Uint8Array(await noteRes.arrayBuffer());
      try {
        const { bytes } = await openItem(noteBuf);
        raw = new TextDecoder().decode(bytes);
      } catch {
        if (!cancelled) setPhase("tamper");
        return;
      }

      // Lazy integrity check (ADR: integrity manifest): a note substituted with
      // its own OLDER valid ciphertext decrypts cleanly — only the manifest hash
      // notices. Best-effort: no manifest / unreadable manifest → no banner here.
      if (manRes?.status === 200) {
        try {
          const opened = await openItem(
            new Uint8Array(await manRes.arrayBuffer()),
          );
          const man: unknown = JSON.parse(
            new TextDecoder().decode(opened.bytes),
          );
          if (isManifest(man)) {
            const recorded = manifestHashFor(man, noteBlob(id));
            if (recorded !== null && recorded !== (await hashBytes(noteBuf)))
              if (!cancelled) setIntegrityAlarm(true);
          }
        } catch {
          // an unreadable manifest is /vault's alarm to raise, not this note's
        }
      }

      // The pure, UNCHANGED preprocessing — wikilinks → /vault/<id>, embeds →
      // /vault/img/<id> (which NoteBody's VaultImg fetches + decrypts).
      const processed = preprocessNote(raw, {
        notes: index.notes,
        images: index.images,
      });

      if (cancelled) return;
      setNote(entry);
      setMd(processed);
      setPhase("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem, id]);

  // --- not unlocked: the store/setup/lock/error gates, no ciphertext touched ---
  if (!unlocked) {
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
    if (vault.status === "error") return <Notice down>{UNREACHABLE}</Notice>;
    return <Notice>…</Notice>; // loading — probing the keystore
  }

  // --- unlocked ---
  if (phase === "unreachable") return <Notice down>{UNREACHABLE}</Notice>;
  if (phase === "tamper") return <Notice down>{TAMPER}</Notice>;
  if (phase === "notfound") return <Notice>note not found</Notice>;
  if (phase !== "ready" || md == null || note == null)
    return <Notice>decrypting…</Notice>;

  // --- unlocked, decrypted ---
  const dir = note.path.includes("/")
    ? note.path.slice(0, note.path.lastIndexOf("/"))
    : "";

  return (
    <>
      <div className="border-b border-hairline px-4 pb-3 pt-6">
        <h1 className="text-lg text-fg">{note.title}</h1>
        <p className="mt-2 text-[11px] tabular-nums text-muted">
          {dir ? `${dir} · ` : ""}
          {note.modified.slice(0, 10)}
        </p>
      </div>

      {integrityAlarm && (
        <div className="mx-4 mt-3 border border-down/60 px-3 py-2 text-xs text-down">
          <p className="font-semibold uppercase tracking-[0.15em]">
            integrity alarm
          </p>
          <p className="mt-1">
            this note&apos;s ciphertext does not match the integrity manifest —
            it may have been substituted or rolled back to an older version.
            compare against your local vault before trusting it.
          </p>
        </div>
      )}

      <NoteBody md={md} openItem={openItem} />
    </>
  );
}

/** A padded status/message block inside the note shell. */
function Notice({ children, down }: { children: ReactNode; down?: boolean }) {
  return (
    <div className={`px-4 py-6 text-sm ${down ? "text-down" : "text-muted"}`}>
      {children}
    </div>
  );
}

/** Locked: an inline passphrase prompt reusing the one master key. */
function UnlockBox({ vault }: { vault: Vault }) {
  const [pass, setPass] = useState("");

  async function submit() {
    if (!pass || vault.working) return;
    await vault.unlock(pass);
    setPass("");
  }

  return (
    <div className="px-4 py-6 text-xs">
      <p className="mb-2 text-muted">
        vault <span className="text-amber">locked</span> — enter the passphrase
        to read this note.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={pass}
          disabled={vault.working}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="passphrase"
          autoFocus
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
