"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
  fileKind,
  formatSize,
  INBOX_PREFIX,
  noteName,
  SHARE_PREFIX,
  shareSegment,
  TEXT_VIEW_MAX,
  UPLOAD_MAX_CONTENT,
  viewKind,
  type FileKind,
  type InboxFile,
} from "@/lib/files";
import { inspect, sniff, strip, type MetaFindings } from "@/lib/exif";
import { SHARE_TTL_DAYS } from "@/lib/shares";
import { RecoverWithShares } from "@/components/RecoveryShares";
import { usePrfCeremonySupported } from "./prfCeremony";
import { useVault, type Vault } from "./useVault";
import { PdfPages } from "./PdfPages";
import { saveAllImages, type SaveAllResult } from "./saveAll";

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

/** The row's one-line preview of a decrypted text. */
function firstLine(text: string): string {
  return text.trimStart().split("\n", 1)[0] ?? "";
}

/** A short one-liner IS its preview; anything more opens the reader under the row. */
function needsReader(text: string): boolean {
  const t = text.trim();
  return t.includes("\n") || t.length > 60;
}

/** Where sw.js stashes share-target files for the window to encrypt + upload. */
const SHARED_CACHE = "anthonyta-shared-v1";

/** This device's answer to "strip photo metadata before upload". */
const STRIP_META_KEY = "files.stripMeta";

/**
 * The strip toggle as this device last left it, read once on mount (the
 * ReaderList pattern; `true` on the server so hydration matches). Stripping is
 * the safe default, but it takes the capture date with it — and the journal
 * import sorts a batch by that date — so the phone that feeds the journal turns
 * it off once and it stays off. A share link still offers its own strip.
 */
function useStoredStripMeta(): boolean {
  const read = useRef<boolean | null>(null);
  const subscribe = useCallback((onStoreChange: () => void) => {
    try {
      read.current = window.localStorage.getItem(STRIP_META_KEY) !== "off";
    } catch {
      read.current = true;
    }
    onStoreChange();
    return () => {};
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => read.current ?? true,
    () => true,
  );
}

/** Everything a share-sheet or picker hands us, normalized for sealing. */
async function toEnvelopeInput(
  file: File,
): Promise<{ meta: EnvelopeMeta; bytes: Uint8Array }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The real name and type ride INSIDE the ciphertext — the server only ever
  // sees `e-<random>.bin`.
  return { meta: { n: file.name, t: file.type || "", s: bytes.length }, bytes };
}

/** True when this envelope looks like an image — by MIME first, extension as backup. */
function isImageMeta(meta: EnvelopeMeta): boolean {
  return meta.t.startsWith("image/") || fileKind(meta.n) === "image";
}

/** Any identifying metadata at all? */
function hasMeta(f: MetaFindings): boolean {
  return f.gps || f.make || f.model || f.dates || f.comments;
}

/** A lowercase, human summary of what was found: "gps + device + timestamps". */
function summarize(f: MetaFindings): string {
  const bits: string[] = [];
  if (f.gps) bits.push("gps");
  if (f.make || f.model) bits.push("device");
  if (f.dates) bits.push("timestamps");
  if (f.comments) bits.push("comments");
  return bits.join(" + ");
}

/**
 * Strip identifying metadata from an image before it's sealed, and report honestly what
 * happened. Non-images never reach here. An unsupported image format (HEIC/AVIF) passes
 * through with its metadata intact — said so plainly rather than pretending to have cleaned it.
 */
function stripForUpload(
  meta: EnvelopeMeta,
  bytes: Uint8Array,
): { meta: EnvelopeMeta; bytes: Uint8Array; notice: string } {
  if (sniff(bytes) === "unknown")
    return {
      meta,
      bytes,
      notice: `${meta.n} · unsupported image · metadata left intact`,
    };
  const found = inspect(bytes);
  if (!hasMeta(found))
    return { meta, bytes, notice: `${meta.n} · no identifying metadata` };
  const cleaned = strip(bytes);
  if (cleaned.length === bytes.length)
    return {
      meta,
      bytes,
      notice: `${meta.n} · metadata present · could not strip`,
    };
  return {
    meta: { ...meta, s: cleaned.length },
    bytes: cleaned,
    notice: `${meta.n} · metadata removed · ${summarize(found)} present`,
  };
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

/** A failure whose message is already written for the owner's eyes — the failed
 *  line renders it verbatim. Anything NOT this class stays the generic line, so
 *  an unexpected throw never leaks internals into the UI. */
class UploadFailure extends Error {}

/**
 * Send one sealed envelope to the store: mint a presigned PUT from the owner-gated
 * route (which validates the pathname shape), then send the bytes straight to R2
 * (ADR 0060). XHR rather than fetch so upload progress can drive the meter. The
 * client-chosen pathname is stored EXACTLY — share links depend on that.
 *
 * Each failure names its stage, because they mean different next moves: a mint
 * refusal usually means the session expired (reload), a drop mid-upload names
 * the percentage it died at (retry — likely a mobile uplink), and a store
 * status is the one worth reporting if it persists.
 */
async function uploadEnvelope(
  pathname: string,
  envelope: Uint8Array,
  onProgress?: (pct: number) => void,
): Promise<void> {
  let mint: Response;
  try {
    mint = await fetch("/api/files/upload", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathname, size: envelope.length }),
    });
  } catch {
    throw new UploadFailure(
      "network dropped before the upload started — retry",
    );
  }
  if (!mint.ok)
    throw new UploadFailure(
      "the hub refused the upload — reload and retry (the session may have expired)",
    );
  const { url } = (await mint.json()) as { url: string };
  let lastPct = 0;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        lastPct = Math.round((e.loaded / e.total) * 100);
        onProgress?.(lastPct);
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new UploadFailure(
              `the store refused the upload (HTTP ${xhr.status}) — retry, and flag it if it keeps happening`,
            ),
          );
    xhr.onerror = () =>
      reject(new UploadFailure(`connection dropped at ${lastPct}% — retry`));
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
  const storedStrip = useStoredStripMeta();
  const [editedStrip, setEditedStrip] = useState<boolean | null>(null);
  const stripMeta = editedStrip ?? storedStrip;
  const [progress, setProgress] = useState<{
    name: string;
    pct: number;
  } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const consumedShare = useRef(false);
  // "save all images": the running count while it decrypts, then what went out.
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [savedAll, setSavedAll] = useState<SaveAllResult | null>(null);
  const [clearing, setClearing] = useState(false);
  // Select mode: tick rows, then delete them together. `armed` is the second
  // tap a bulk delete asks for — R2 keeps no versions, so there is no undo.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [delFailed, setDelFailed] = useState(0);

  const unlocked = vault.status === "unlocked";

  // Success is null; failure is the line the red row prints. Sealing and
  // uploading fail for different reasons with different next moves, so they
  // stop sharing one word.
  const sealAndUpload = useCallback(
    async (
      meta: EnvelopeMeta,
      bytes: Uint8Array,
      label: string,
    ): Promise<string | null> => {
      let envelope: Uint8Array;
      try {
        envelope = await vault.sealItem(meta, bytes);
      } catch {
        return "encryption failed — reload, unlock, and retry";
      }
      try {
        await uploadEnvelope(
          `${INBOX_PREFIX}e-${randomId()}.bin`,
          envelope,
          (pct) => setProgress({ name: label, pct }),
        );
        return null;
      } catch (err) {
        return err instanceof UploadFailure ? err.message : "upload failed";
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
      setNotices([]);
      const errored: string[] = [];
      const noted: string[] = [];
      for (const file of chosen) {
        // Refuse oversize BEFORE reading a byte, and say why — the mint would
        // reject it anyway, but as a generic failure with no reason given
        // (which is how a 30MB video read as "broken" instead of "too big").
        if (file.size > UPLOAD_MAX_CONTENT) {
          noted.push(
            `${file.name} skipped — ${formatSize(file.size)} is over the ${formatSize(UPLOAD_MAX_CONTENT)} cap`,
          );
          continue;
        }
        setProgress({ name: file.name, pct: 0 });
        let input: Awaited<ReturnType<typeof toEnvelopeInput>>;
        try {
          input = await toEnvelopeInput(file);
        } catch {
          // A cloud-placeholder file (synced but not local) is the usual cause.
          errored.push(
            `${file.name} — couldn't read the file from this device`,
          );
          continue;
        }
        try {
          let { meta, bytes } = input;
          if (stripMeta && isImageMeta(meta)) {
            const r = stripForUpload(meta, bytes);
            meta = r.meta;
            bytes = r.bytes;
            noted.push(r.notice);
          }
          const failure = await sealAndUpload(meta, bytes, file.name);
          if (failure !== null) errored.push(`${file.name} — ${failure}`);
        } catch {
          errored.push(`${file.name} — upload failed`);
        }
      }
      setProgress(null);
      setFailed(errored);
      setNotices(noted);
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    },
    [busy, unlocked, stripMeta, sealAndUpload, router],
  );

  async function sendNote() {
    const text = note;
    if (!text.trim() || busy || !unlocked) return;
    setBusy(true);
    setFailed([]);
    setProgress({ name: "note", pct: 0 });
    const bytes = new TextEncoder().encode(text);
    const failure = await sealAndUpload(
      { n: noteName(text), t: "text/plain", s: bytes.length },
      bytes,
      "note",
    );
    setProgress(null);
    setBusy(false);
    if (failure === null) {
      setNote("");
      router.refresh();
    } else {
      setFailed([`note — ${failure}`]);
    }
  }

  async function saveAll() {
    if (saving || !unlocked) return;
    setSavedAll(null);
    setSaving({ done: 0, total: 0 });
    try {
      setSavedAll(
        await saveAllImages(files, vault.openItem, isImageMeta, (done, total) =>
          setSaving({ done, total }),
        ),
      );
    } finally {
      setSaving(null);
    }
  }

  // Offered only after a folder write, where every saved row is known to be on
  // disk — a plain download can be refused by the browser without a word.
  async function clearSaved() {
    if (!savedAll || clearing) return;
    setClearing(true);
    const left: string[] = [];
    for (const pathname of savedAll.saved)
      if (!(await removeFile(pathname))) left.push(pathname);
    setSavedAll(left.length > 0 ? { ...savedAll, saved: left } : null);
    setClearing(false);
    router.refresh();
  }

  // Ticks only count while their row is still in the list.
  const pickedNow = files.filter((f) => picked.has(f.pathname));

  function togglePick(pathname: string) {
    setArmed(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(pathname)) next.add(pathname);
      return next;
    });
  }

  function stopPicking() {
    setPicking(false);
    setPicked(new Set());
    setArmed(false);
    setDelFailed(0);
  }

  async function deletePicked() {
    if (deleting || pickedNow.length === 0) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setDelFailed(0);
    const left = new Set<string>();
    let done = 0;
    for (const f of pickedNow) {
      setDeleting({ done: done++, total: pickedNow.length });
      if (!(await removeFile(f.pathname))) left.add(f.pathname);
    }
    setDeleting(null);
    // A row that wouldn't go stays ticked, so the next tap retries just those.
    setPicked(left);
    setDelFailed(left.size);
    if (left.size === 0) setPicking(false);
    router.refresh();
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

          <button
            type="button"
            onClick={() => {
              const next = !stripMeta;
              setEditedStrip(next);
              try {
                window.localStorage.setItem(
                  STRIP_META_KEY,
                  next ? "on" : "off",
                );
              } catch {
                // A blocked store just means the choice lasts as long as the page.
              }
            }}
            disabled={busy}
            className="mt-2 font-mono text-xs text-muted transition-colors hover:text-amber disabled:opacity-50"
          >
            <span className="text-amber">{stripMeta ? "[x]" : "[ ]"}</span>{" "}
            strip photo metadata before upload
          </button>

          {notices.map((n, i) => (
            <p key={`${i}-${n}`} className="mt-1 font-mono text-xs text-muted">
              {n}
            </p>
          ))}

          {progress && (
            <p className="mt-2 font-mono text-xs text-muted">
              encrypting + uploading {progress.name} ·{" "}
              <span className="tabular-nums text-amber">{progress.pct}%</span>
            </p>
          )}

          {failed.map((line, i) => (
            <p key={`${i}-${line}`} className="mt-2 text-xs text-down">
              {line}
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
          {picking ? (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 font-mono text-xs text-muted">
              <span>
                <span className="tabular-nums text-amber">
                  {pickedNow.length}
                </span>{" "}
                selected
              </span>
              <button
                type="button"
                onClick={() => {
                  setArmed(false);
                  setPicked(
                    pickedNow.length === files.length
                      ? new Set()
                      : new Set(files.map((f) => f.pathname)),
                  );
                }}
                disabled={deleting !== null}
                className="transition-colors hover:text-amber disabled:opacity-30"
              >
                {pickedNow.length === files.length ? "none" : "all"}
              </button>
              {deleting ? (
                <span>
                  deleting{" "}
                  <span className="tabular-nums text-amber">
                    {deleting.done + 1}/{deleting.total}
                  </span>
                </span>
              ) : (
                pickedNow.length > 0 && (
                  <button
                    type="button"
                    onClick={deletePicked}
                    className={
                      armed ? "text-down" : "transition-colors hover:text-down"
                    }
                  >
                    {armed
                      ? `sure? del ${pickedNow.length} for good`
                      : `del ${pickedNow.length}`}
                  </button>
                )
              )}
              {delFailed > 0 && !deleting && (
                <span className="text-down">
                  {delFailed} failed — try again
                </span>
              )}
              <button
                type="button"
                onClick={stopPicking}
                disabled={deleting !== null}
                className="transition-colors hover:text-amber disabled:opacity-30"
              >
                done
              </button>
            </li>
          ) : (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 font-mono text-xs text-muted">
              {unlocked && files.some((f) => f.encrypted) && (
                <>
                  <button
                    type="button"
                    onClick={saveAll}
                    disabled={saving !== null || clearing}
                    className="transition-colors hover:text-amber disabled:opacity-30"
                  >
                    save all images
                  </button>
                  {saving && saving.total > 0 && (
                    <span>
                      decrypting{" "}
                      <span className="tabular-nums text-amber">
                        {saving.done + 1}/{saving.total}
                      </span>
                    </span>
                  )}
                  {savedAll && (
                    <span>
                      {savedAll.saved.length === 0
                        ? "no images here"
                        : savedAll.folder
                          ? `${savedAll.saved.length} saved → ${savedAll.folder}`
                          : `${savedAll.saved.length} sent to downloads`}
                      {savedAll.failed > 0 && (
                        <span className="text-down">
                          {" "}
                          · {savedAll.failed} failed
                        </span>
                      )}
                    </span>
                  )}
                  {savedAll?.folder && savedAll.saved.length > 0 && (
                    <button
                      type="button"
                      onClick={clearSaved}
                      disabled={clearing}
                      className="transition-colors hover:text-down disabled:opacity-30"
                    >
                      del those {savedAll.saved.length} from the inbox
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => setPicking(true)}
                disabled={saving !== null || clearing}
                className="transition-colors hover:text-amber disabled:opacity-30"
              >
                select
              </button>
            </li>
          )}
          {files.map((f) =>
            f.encrypted ? (
              <EncryptedRow
                key={f.pathname}
                f={f}
                vault={vault}
                onChanged={() => router.refresh()}
                pick={
                  picking
                    ? {
                        on: picked.has(f.pathname),
                        toggle: () => togglePick(f.pathname),
                      }
                    : undefined
                }
              />
            ) : (
              <FileRow
                key={f.pathname}
                f={f}
                onChanged={() => router.refresh()}
                pick={
                  picking
                    ? {
                        on: picked.has(f.pathname),
                        toggle: () => togglePick(f.pathname),
                      }
                    : undefined
                }
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

/** Keystore exists, no cached key: prompt and derive — passphrase or passkey. */
function LockedPanel({ vault }: { vault: Vault }) {
  const [pass, setPass] = useState("");
  // Client-only capability probe: only offer the passkey path where WebAuthn PRF
  // can even be attempted. The passphrase box is always the fallback.
  const passkeyCapable = usePrfCeremonySupported();

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
      {passkeyCapable && (
        <button
          type="button"
          onClick={() => vault.unlockWithPasskey()}
          disabled={vault.working}
          className="mt-2 text-muted transition-colors hover:text-amber disabled:opacity-30"
        >
          unlock with passkey
        </button>
      )}
      {vault.error && <p className="mt-2 text-down">{vault.error}</p>}
      <RecoverWithShares />
    </div>
  );
}

// ---------------------------------------------------------------------------
// rows
// ---------------------------------------------------------------------------

/** A row's part in the list's select mode: whether it's ticked, and the tick. */
interface RowPick {
  on: boolean;
  toggle: () => void;
}

/** The tick box a row wears while the list is in select mode — the strip
 *  toggle's `[x]`, sized for a thumb. */
function PickBox({ pick }: { pick: RowPick }) {
  return (
    <button
      type="button"
      onClick={pick.toggle}
      aria-pressed={pick.on}
      aria-label={pick.on ? "deselect" : "select"}
      className="flex h-10 w-8 shrink-0 items-center font-mono text-xs text-amber"
    >
      {pick.on ? "[x]" : "[ ]"}
    </button>
  );
}

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
function FileRow({
  f,
  onChanged,
  pick,
}: {
  f: InboxFile;
  onChanged: () => void;
  pick?: RowPick;
}) {
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
        {pick && <PickBox pick={pick} />}
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

        <div
          className={`shrink-0 items-center gap-3 text-xs ${pick ? "hidden" : "flex"}`}
        >
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
 * bigger decrypts on tap. Decrypted, the item is VIEWED by default — text in a
 * reader under the row, images/PDF/media off an object URL — and the save link
 * is the secondary door. The object URL dies on lock or unmount.
 */
function EncryptedRow({
  f,
  vault,
  onChanged,
  pick,
}: {
  f: InboxFile;
  vault: Vault;
  onChanged: () => void;
  pick?: RowPick;
}) {
  const [busy, setBusy] = useState(false);
  const [decErr, setDecErr] = useState(false);
  const [item, setItem] = useState<{
    meta: EnvelopeMeta;
    text?: string;
    url?: string;
    /** Kept alongside the object URL for PDFs only — the in-page renderer
     *  takes bytes (a blob: URL can't be fetched under connect-src 'self'). */
    bytes?: Uint8Array;
  } | null>(null);
  const [copyLabel, setCopyLabel] = useState("copy");
  const [shareLabel, setShareLabel] = useState("share");
  const [sharing, setSharing] = useState(false);
  // The viewer under the row folds away per row (long notes stack up once
  // everything auto-decrypts); it reopens with the next decrypt.
  const [folded, setFolded] = useState(false);
  // A pre-strip image about to be shared: the decrypted bytes + what they carry,
  // held only until the owner picks strip-or-keep, then dropped.
  const [shareChoice, setShareChoice] = useState<{
    meta: EnvelopeMeta;
    bytes: Uint8Array;
    found: MetaFindings;
  } | null>(null);
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
      const url = URL.createObjectURL(
        new Blob([bytes as BlobPart], {
          type: meta.t || "application/octet-stream",
        }),
      );
      urlRef.current = url;
      const kind = viewKind(meta.t);
      if (kind === "text" && bytes.length <= TEXT_VIEW_MAX) {
        setItem({ meta, url, text: new TextDecoder().decode(bytes) });
      } else {
        setItem(kind === "pdf" ? { meta, url, bytes } : { meta, url });
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
      setFolded(false);
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

  // Re-seal these bytes under a FRESH one-time key, upload the ciphertext to `share/`,
  // and hand back a link whose fragment carries that key. The server only ever holds the
  // re-encrypted bytes; the key travels in the URL, never to us.
  async function doShare(meta: EnvelopeMeta, bytes: Uint8Array) {
    setShareChoice(null);
    setSharing(true);
    try {
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

  // Share is the last line of defense: an image sealed before this feature (or with the
  // strip toggle off) still carries GPS/EXIF inside its envelope, and a share hands the
  // decrypted bytes to a recipient. So decrypt, re-inspect, and OFFER a strip before
  // re-sealing — anything clean (or a non-image) shares straight through.
  async function share() {
    if (sharing || shareChoice) return;
    setSharing(true);
    try {
      const res = await fetch(
        `/api/files/raw?p=${encodeURIComponent(f.pathname)}`,
      );
      if (!res.ok) throw new Error("fetch failed");
      const envelope = new Uint8Array(await res.arrayBuffer());
      const { meta, bytes } = await vault.openItem(envelope);
      if (sniff(bytes) !== "unknown") {
        const found = inspect(bytes);
        if (hasMeta(found)) {
          setSharing(false);
          setShareChoice({ meta, bytes, found });
          return;
        }
      }
      await doShare(meta, bytes);
    } catch {
      setShareLabel("error");
      setSharing(false);
      setTimeout(() => setShareLabel("share"), 2000);
    }
  }

  function stripAndShare() {
    if (!shareChoice) return;
    const cleaned = strip(shareChoice.bytes);
    void doShare({ ...shareChoice.meta, s: cleaned.length }, cleaned);
  }

  const hasViewer =
    item?.text !== undefined
      ? needsReader(item.text)
      : item?.url !== undefined && viewKind(item.meta.t) !== null;

  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        {pick && <PickBox pick={pick} />}
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center border border-hairline font-mono text-[10px] ${
            item ? "text-muted" : "text-amber"
          }`}
        >
          [{item ? (item.text !== undefined ? "txt" : "bin") : "enc"}]
        </span>

        <div className="min-w-0 flex-1">
          {item?.text !== undefined ? (
            <p className="truncate font-mono text-[13px] text-fg">
              {firstLine(item.text)}
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

        <div
          className={`shrink-0 items-center gap-3 text-xs ${pick ? "hidden" : "flex"}`}
        >
          {hasViewer && (
            <button
              type="button"
              onClick={() => setFolded((v) => !v)}
              className="text-muted transition-colors hover:text-amber"
            >
              {folded ? "open" : "fold"}
            </button>
          )}
          {item?.text !== undefined && (
            <button
              type="button"
              onClick={() => copyText(item.text!)}
              className="text-muted transition-colors hover:text-amber"
            >
              {copyLabel}
            </button>
          )}
          {item?.url ? (
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

      {/* The in-browser viewer: a decrypted item renders straight off its object
          URL — nothing lands in the device's Downloads folder, and the URL (with
          the bytes behind it) still dies on lock and unmount above. Tap-to-decrypt
          is the intent gate: only rows the owner opened grow a preview. */}
      {!folded && item?.text !== undefined && needsReader(item.text) && (
        <pre className="mt-2 max-h-[60vh] overflow-y-auto border border-hairline p-3 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-fg">
          {item.text}
        </pre>
      )}
      {!folded && item?.url && viewKind(item.meta.t) === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.url}
          alt={item.meta.n}
          className="mt-2 max-h-[60vh] max-w-full border border-hairline object-contain"
        />
      )}
      {!folded &&
        item?.url &&
        viewKind(item.meta.t) === "pdf" &&
        (/Android/i.test(navigator.userAgent) ? (
          // Android Chrome has no inline PDF viewer — a blob: iframe would render
          // a dead grey box — so the pages are drawn here with self-hosted pdf.js.
          item.bytes && <PdfPages bytes={item.bytes} name={item.meta.n} />
        ) : (
          <iframe
            src={item.url}
            title={item.meta.n}
            className="mt-2 h-[70vh] w-full border border-hairline"
          />
        ))}
      {!folded && item?.url && viewKind(item.meta.t) === "video" && (
        <video
          src={item.url}
          controls
          loop
          playsInline
          preload="metadata"
          className="mt-2 max-h-[60vh] w-full border border-hairline"
        />
      )}
      {!folded && item?.url && viewKind(item.meta.t) === "audio" && (
        <audio src={item.url} controls className="mt-2 w-full" />
      )}

      {shareChoice && (
        <div className="mt-2 flex flex-wrap items-center gap-3 border-l border-hairline pl-3 font-mono text-xs">
          <span className="text-muted">
            this share carries {summarize(shareChoice.found)}
          </span>
          <button
            type="button"
            onClick={stripAndShare}
            className="text-amber transition-colors hover:underline"
          >
            strip + share
          </button>
          <button
            type="button"
            onClick={() => doShare(shareChoice.meta, shareChoice.bytes)}
            className="text-muted transition-colors hover:text-amber"
          >
            keep + share
          </button>
          <button
            type="button"
            onClick={() => setShareChoice(null)}
            className="text-muted transition-colors hover:text-amber"
          >
            cancel
          </button>
        </div>
      )}
    </li>
  );
}
