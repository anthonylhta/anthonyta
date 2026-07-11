"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  exportKeyRaw,
  generateShareKey,
  randomId,
  seal,
  toB64url,
  type EnvelopeMeta,
} from "@/lib/crypto";
import {
  age,
  formatSize,
  INBOX_PREFIX,
  noteName,
  SHARE_PREFIX,
  shareSegment,
  type FileKind,
  type InboxFile,
} from "@/lib/files";
import { SHARE_TTL_DAYS } from "@/lib/shares";
import { useVault, type Vault } from "./useVault";

// Short type tags for the non-image thumbnail slot.
const KIND_TAG: Record<FileKind, string> = {
  image: "img",
  doc: "doc",
  archive: "zip",
  audio: "aud",
  video: "vid",
  other: "bin",
};

/** Ciphertext at or below this auto-decrypts once unlocked — notes, essentially. */
const AUTO_DECRYPT_MAX = 8192;

/** Where sw.js stashes share-target files for the window to encrypt + upload. */
const SHARED_CACHE = "anthonyta-shared-v1";

/** Everything a share-sheet or picker hands us, normalized for sealing. */
async function toEnvelopeInput(
  file: File,
): Promise<{ meta: EnvelopeMeta; bytes: Uint8Array }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The real name and type ride INSIDE the ciphertext — the server only ever
  // sees `e-<random>.bin`.
  return { meta: { n: file.name, t: file.type || "", s: bytes.length }, bytes };
}

/** Drain the SW share stash (populated by sw.js on a share-sheet POST). */
async function drainSharedCache(): Promise<File[]> {
  if (!("caches" in window)) return [];
  try {
    const cache = await caches.open(SHARED_CACHE);
    const out: File[] = [];
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      await cache.delete(req);
      if (!res) continue;
      const blob = await res.blob();
      const name = decodeURIComponent(
        res.headers.get("x-shared-name") ?? "shared",
      );
      out.push(new File([blob], name, { type: blob.type }));
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Send one sealed envelope to the store: mint a presigned PUT from the owner-gated
 * route (which validates the pathname shape), then send the bytes straight to R2
 * (ADR 0060). XHR rather than fetch so upload progress can drive the meter. The
 * client-chosen pathname is stored EXACTLY — share links depend on that.
 */
async function uploadEnvelope(
  pathname: string,
  envelope: Uint8Array,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const mint = await fetch("/api/files/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pathname, size: envelope.length }),
  });
  if (!mint.ok) throw new Error("mint failed");
  const { url } = (await mint.json()) as { url: string };
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`upload failed: HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error("upload failed"));
    xhr.send(new Blob([envelope as BlobPart]));
  });
}

async function removeFile(pathname: string): Promise<boolean> {
  try {
    const res = await fetch("/api/files/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathname }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The owner-only files inbox: an always-encrypting uploader + a disposable file list. */
export function FilesInbox({
  files,
  offline,
  shared,
}: {
  files: InboxFile[];
  offline: boolean;
  shared?: boolean;
}) {
  const router = useRouter();
  const vault = useVault(offline);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<{
    name: string;
    pct: number;
  } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const consumedShare = useRef(false);

  const unlocked = vault.status === "unlocked";

  const sealAndUpload = useCallback(
    async (
      meta: EnvelopeMeta,
      bytes: Uint8Array,
      label: string,
    ): Promise<boolean> => {
      try {
        const envelope = await vault.sealItem(meta, bytes);
        await uploadEnvelope(
          `${INBOX_PREFIX}e-${randomId()}.bin`,
          envelope,
          (pct) => setProgress({ name: label, pct }),
        );
        return true;
      } catch {
        return false;
      }
    },
    [vault],
  );

  const handleFiles = useCallback(
    async (list: FileList | File[] | null) => {
      if (!list || list.length === 0 || busy || !unlocked) return;
      const chosen = Array.from(list);
      setBusy(true);
      setFailed([]);
      const errored: string[] = [];
      for (const file of chosen) {
        setProgress({ name: file.name, pct: 0 });
        try {
          const { meta, bytes } = await toEnvelopeInput(file);
          if (!(await sealAndUpload(meta, bytes, file.name)))
            errored.push(file.name);
        } catch {
          errored.push(file.name);
        }
      }
      setProgress(null);
      setFailed(errored);
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    },
    [busy, unlocked, sealAndUpload, router],
  );

  async function sendNote() {
    const text = note;
    if (!text.trim() || busy || !unlocked) return;
    setBusy(true);
    setFailed([]);
    setProgress({ name: "note", pct: 0 });
    const bytes = new TextEncoder().encode(text);
    const ok = await sealAndUpload(
      { n: noteName(text), t: "text/plain", s: bytes.length },
      bytes,
      "note",
    );
    setProgress(null);
    setBusy(false);
    if (ok) {
      setNote("");
      router.refresh();
    } else {
      setFailed(["note"]);
    }
  }

  // A share-sheet landing (?shared=1): pick up what the SW stashed once the
  // vault is open, then run it through the same encrypt-and-upload path. The
  // busy guard matters: draining removes the stash, and handleFiles no-ops
  // while an upload is in flight — so drain only when it can actually run
  // (the effect re-fires when busy clears).
  useEffect(() => {
    if (!shared || !unlocked || busy || consumedShare.current) return;
    consumedShare.current = true;
    (async () => {
      const stashed = await drainSharedCache();
      if (stashed.length > 0) await handleFiles(stashed);
    })();
  }, [shared, unlocked, busy, handleFiles]);

  return (
    <div className="px-4 py-4">
      {vault.status === "setup" && <SetupPanel vault={vault} />}
      {vault.status === "locked" && <LockedPanel vault={vault} />}
      {vault.status === "error" && (
        <p className="mb-4 text-xs text-down">
          vault unreachable — reload to retry (your key is untouched)
        </p>
      )}

      {unlocked && (
        <div className="mb-4">
          <VaultBar vault={vault} />

          <div className="mb-3 flex items-start gap-2">
            <span className="mt-1.5 font-mono text-sm text-amber">&gt;</span>
            <textarea
              rows={2}
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                // isComposing: Enter confirming an IME candidate (JP/ZH input)
                // must not fire the send.
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  sendNote();
                }
              }}
              placeholder="paste text · enter to send encrypted"
              className="flex-1 resize-none bg-transparent py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:outline-none disabled:opacity-50"
            />
          </div>

          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer items-center justify-center border border-dashed px-3 py-4 text-xs transition-colors ${
              dragging
                ? "border-amber text-amber"
                : "border-hairline text-muted hover:border-amber hover:text-amber"
            } ${busy ? "pointer-events-none opacity-50" : ""}`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              disabled={busy}
              onChange={(e) => handleFiles(e.target.files)}
              className="sr-only"
            />
            <span>
              <span className="text-amber">+</span> drop files here — encrypted
              before upload
            </span>
          </label>

          {progress && (
            <p className="mt-2 font-mono text-xs text-muted">
              encrypting + uploading {progress.name} ·{" "}
              <span className="tabular-nums text-amber">{progress.pct}%</span>
            </p>
          )}

          {failed.map((name, i) => (
            <p key={`${i}-${name}`} className="mt-2 text-xs text-down">
              upload failed — {name}
            </p>
          ))}
        </div>
      )}

      {files.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">
          inbox empty — send something from any device
        </p>
      ) : (
        <ul className="divide-y divide-hairline/40">
          {files.map((f) =>
            f.encrypted ? (
              <EncryptedRow
                key={f.pathname}
                f={f}
                vault={vault}
                onChanged={() => router.refresh()}
              />
            ) : (
              <FileRow
                key={f.pathname}
                f={f}
                onChanged={() => router.refresh()}
              />
            ),
          )}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// vault chrome
// ---------------------------------------------------------------------------

/** The unlocked header strip: status, lock, and the change-passphrase flyout. */
function VaultBar({ vault }: { vault: Vault }) {
  const [changing, setChanging] = useState(false);
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [mismatch, setMismatch] = useState(false);

  async function submit() {
    setMismatch(false);
    if (!oldPass || !newPass) return;
    if (newPass !== newPass2) {
      setMismatch(true);
      return;
    }
    if (await vault.changePassphrase(oldPass, newPass)) {
      setChanging(false);
      setOldPass("");
      setNewPass("");
      setNewPass2("");
    }
  }

  const input =
    "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";

  return (
    <div className="mb-3 border border-hairline px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted">
          vault <span className="text-amber">unlocked</span> — new items encrypt
          on this device
        </span>
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setChanging((v) => !v)}
            className="text-muted transition-colors hover:text-amber"
          >
            change passphrase
          </button>
          <button
            type="button"
            onClick={() => vault.lock()}
            className="text-muted transition-colors hover:text-amber"
          >
            lock
          </button>
        </span>
      </div>

      {changing && (
        <div className="mt-2 flex flex-col gap-2">
          <input
            type="password"
            value={oldPass}
            disabled={vault.working}
            onChange={(e) => setOldPass(e.target.value)}
            placeholder="current passphrase"
            className={input}
          />
          <input
            type="password"
            value={newPass}
            disabled={vault.working}
            onChange={(e) => setNewPass(e.target.value)}
            placeholder="new passphrase"
            className={input}
          />
          <input
            type="password"
            value={newPass2}
            disabled={vault.working}
            onChange={(e) => setNewPass2(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="new passphrase, again"
            className={input}
          />
          <button
            type="button"
            onClick={submit}
            disabled={vault.working || !oldPass || !newPass}
            className="self-start border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30"
          >
            {vault.working ? "re-wrapping…" : "change"}
          </button>
          {mismatch && (
            <p className="text-down">new passphrases don&apos;t match</p>
          )}
          {vault.error && <p className="text-down">{vault.error}</p>}
          <p className="text-muted/60">
            only the key wrapper changes — nothing is re-encrypted.
          </p>
        </div>
      )}
    </div>
  );
}

/** First run: create the vault passphrase. */
function SetupPanel({ vault }: { vault: Vault }) {
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [mismatch, setMismatch] = useState(false);

  async function submit() {
    setMismatch(false);
    if (!pass) return;
    if (pass !== pass2) {
      setMismatch(true);
      return;
    }
    await vault.setup(pass);
  }

  const input =
    "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";

  return (
    <div className="mb-4 border border-hairline px-3 py-3 text-xs">
      <p className="mb-2 text-muted">
        <span className="text-amber">first run</span> — set a vault passphrase.
        everything dropped here is encrypted on your device before upload.
      </p>
      <div className="flex flex-col gap-2">
        <input
          type="password"
          value={pass}
          disabled={vault.working}
          onChange={(e) => setPass(e.target.value)}
          placeholder="passphrase"
          className={input}
        />
        <input
          type="password"
          value={pass2}
          disabled={vault.working}
          onChange={(e) => setPass2(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="passphrase, again"
          className={input}
        />
        <button
          type="button"
          onClick={submit}
          disabled={vault.working || !pass}
          className="self-start border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30"
        >
          {vault.working ? "deriving key…" : "create vault"}
        </button>
        {mismatch && <p className="text-down">passphrases don&apos;t match</p>}
        {vault.error && <p className="text-down">{vault.error}</p>}
        {pass.length > 0 && pass.length < 12 && (
          <p className="text-muted/60">
            longer is stronger — four random words beat any symbol soup.
          </p>
        )}
        <p className="text-down/80">
          the passphrase cannot be recovered. losing it loses everything
          encrypted under it.
        </p>
      </div>
    </div>
  );
}

/** Keystore exists, no cached key: prompt and derive. */
function LockedPanel({ vault }: { vault: Vault }) {
  const [pass, setPass] = useState("");

  async function submit() {
    if (!pass || vault.working) return;
    await vault.unlock(pass);
    setPass("");
  }

  return (
    <div className="mb-4 border border-hairline px-3 py-3 text-xs">
      <p className="mb-2 text-muted">
        vault <span className="text-amber">locked</span> — enter the passphrase
        to decrypt on this device.
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
          className="flex-1 border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={vault.working || !pass}
          className="border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30"
        >
          {vault.working ? "deriving key…" : "unlock"}
        </button>
      </div>
      {vault.error && <p className="mt-2 text-down">{vault.error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

function DelButton({
  pathname,
  onChanged,
}: {
  pathname: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          setBusy(true);
          setError(false);
          if (await removeFile(pathname)) onChanged();
          else {
            setError(true);
            setBusy(false);
          }
        }}
        disabled={busy}
        className="text-muted transition-colors hover:text-down disabled:opacity-30"
      >
        del
      </button>
      {error && (
        <span className="text-[11px] text-down">delete failed — try again</span>
      )}
    </>
  );
}

/** A legacy plaintext row — a file (thumbnail, dl · del) or an inlined text note (copy · del). */
function FileRow({ f, onChanged }: { f: InboxFile; onChanged: () => void }) {
  const [copyLabel, setCopyLabel] = useState("copy");

  const dl = `/api/files/dl?p=${encodeURIComponent(f.pathname)}`;
  const noteText = f.text;

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyLabel("copied");
    } catch {
      setCopyLabel("error");
    } finally {
      setTimeout(() => setCopyLabel("copy"), 2000);
    }
  }

  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        {noteText !== undefined ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-hairline font-mono text-[10px] text-muted">
            [txt]
          </span>
        ) : f.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dl}
            loading="lazy"
            alt=""
            className="h-10 w-10 shrink-0 border border-hairline object-cover"
          />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-hairline font-mono text-[10px] text-muted">
            [{KIND_TAG[f.kind]}]
          </span>
        )}

        <div className="min-w-0 flex-1">
          {noteText !== undefined ? (
            <p className="line-clamp-3 font-mono text-[13px] break-words whitespace-pre-wrap text-fg">
              {noteText}
            </p>
          ) : (
            <p className="truncate text-[13px] text-fg">{f.name}</p>
          )}
          <p className="text-xs text-muted">
            {formatSize(f.size)} · {age(f.uploadedAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs">
          {noteText !== undefined ? (
            <button
              type="button"
              onClick={() => copyText(noteText)}
              className="text-muted transition-colors hover:text-amber"
            >
              {copyLabel}
            </button>
          ) : (
            <a
              href={dl}
              download
              className="text-muted transition-colors hover:text-amber"
            >
              dl
            </a>
          )}
          <DelButton pathname={f.pathname} onChanged={onChanged} />
        </div>
      </div>
    </li>
  );
}

/**
 * An E2EE envelope row. Sealed, it shows only what the server knows: ciphertext
 * size and age. Small ciphertext (notes) auto-decrypts once unlocked; anything
 * bigger decrypts on tap, revealing its real name and a save link backed by an
 * object URL that dies on lock or unmount.
 */
function EncryptedRow({
  f,
  vault,
  onChanged,
}: {
  f: InboxFile;
  vault: Vault;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [decErr, setDecErr] = useState(false);
  const [item, setItem] = useState<{
    meta: EnvelopeMeta;
    text?: string;
    url?: string;
  } | null>(null);
  const [copyLabel, setCopyLabel] = useState("copy");
  const [shareLabel, setShareLabel] = useState("share");
  const [sharing, setSharing] = useState(false);
  const urlRef = useRef<string | null>(null);
  const inflight = useRef(false);

  const unlocked = vault.status === "unlocked";
  const auto = f.size <= AUTO_DECRYPT_MAX;

  const decrypt = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    // Yield first so the auto-decrypt effect never sets state synchronously.
    await Promise.resolve();
    setBusy(true);
    setDecErr(false);
    try {
      const res = await fetch(
        `/api/files/raw?p=${encodeURIComponent(f.pathname)}`,
      );
      if (!res.ok) throw new Error("fetch failed");
      const envelope = new Uint8Array(await res.arrayBuffer());
      const { meta, bytes } = await vault.openItem(envelope);
      if (meta.t === "text/plain") {
        setItem({ meta, text: new TextDecoder().decode(bytes) });
      } else {
        const url = URL.createObjectURL(
          new Blob([bytes as BlobPart], {
            type: meta.t || "application/octet-stream",
          }),
        );
        urlRef.current = url;
        setItem({ meta, url });
      }
    } catch {
      setDecErr(true);
    } finally {
      setBusy(false);
      inflight.current = false;
    }
  }, [f.pathname, vault]);

  // Notes-sized ciphertext opens itself as soon as the key is available. The
  // microtask hop keeps every setState out of the effect's synchronous body.
  useEffect(() => {
    if (unlocked && auto && !item && !decErr)
      void Promise.resolve().then(decrypt);
  }, [unlocked, auto, item, decErr, decrypt]);

  // Lock forgets every decrypted byte the React way — adjust state during
  // render on the unlocked→locked transition (no effect, no extra paint).
  const [prevUnlocked, setPrevUnlocked] = useState(unlocked);
  if (unlocked !== prevUnlocked) {
    setPrevUnlocked(unlocked);
    if (!unlocked) {
      setItem(null);
      setDecErr(false);
    }
  }

  // The object URL is an external resource: revoke on lock and on unmount.
  useEffect(() => {
    if (!unlocked && urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, [unlocked]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyLabel("copied");
    } catch {
      setCopyLabel("error");
    } finally {
      setTimeout(() => setCopyLabel("copy"), 2000);
    }
  }

  // Share = re-seal this item under a FRESH one-time key, upload the ciphertext to
  // `share/`, and hand back a link whose fragment carries that key. The server only
  // ever holds the re-encrypted bytes; the key travels in the URL, never to us.
  async function share() {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await fetch(
        `/api/files/raw?p=${encodeURIComponent(f.pathname)}`,
      );
      if (!res.ok) throw new Error("fetch failed");
      const envelope = new Uint8Array(await res.arrayBuffer());
      const { meta, bytes } = await vault.openItem(envelope);
      const key = await generateShareKey();
      const sealed = await seal(key, meta, bytes);
      const rawKey = await exportKeyRaw(key);
      const expiry = Math.floor(Date.now() / 1000) + SHARE_TTL_DAYS * 86400;
      const seg = shareSegment(expiry, randomId());
      await uploadEnvelope(`${SHARE_PREFIX}${seg}.bin`, sealed);
      const link = `${location.origin}/s/${seg}#${toB64url(rawKey)}`;
      await navigator.clipboard.writeText(link);
      setShareLabel(`copied · ${SHARE_TTL_DAYS}d`);
    } catch {
      setShareLabel("error");
    } finally {
      setSharing(false);
      setTimeout(() => setShareLabel("share"), 2000);
    }
  }

  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center border border-hairline font-mono text-[10px] ${
            item ? "text-muted" : "text-amber"
          }`}
        >
          [{item ? (item.text !== undefined ? "txt" : "bin") : "enc"}]
        </span>

        <div className="min-w-0 flex-1">
          {item?.text !== undefined ? (
            <p className="line-clamp-3 font-mono text-[13px] break-words whitespace-pre-wrap text-fg">
              {item.text}
            </p>
          ) : item ? (
            <p className="truncate text-[13px] text-fg">{item.meta.n}</p>
          ) : (
            <p className="text-[13px] text-muted">
              {decErr ? (
                <span className="text-down">can&apos;t decrypt</span>
              ) : busy ? (
                "decrypting…"
              ) : (
                "encrypted"
              )}
            </p>
          )}
          <p className="text-xs text-muted">
            {formatSize(f.size)} · {age(f.uploadedAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs">
          {item?.text !== undefined ? (
            <button
              type="button"
              onClick={() => copyText(item.text!)}
              className="text-muted transition-colors hover:text-amber"
            >
              {copyLabel}
            </button>
          ) : item?.url ? (
            <a
              href={item.url}
              download={item.meta.n}
              className="text-muted transition-colors hover:text-amber"
            >
              save
            </a>
          ) : unlocked && !auto && !busy ? (
            <button
              type="button"
              onClick={decrypt}
              className="text-muted transition-colors hover:text-amber"
            >
              decrypt
            </button>
          ) : null}
          {unlocked && (
            <button
              type="button"
              onClick={share}
              disabled={sharing}
              className="text-muted transition-colors hover:text-amber disabled:opacity-30"
            >
              {sharing ? "sharing…" : shareLabel}
            </button>
          )}
          <DelButton pathname={f.pathname} onChanged={onChanged} />
        </div>
      </div>
    </li>
  );
}
