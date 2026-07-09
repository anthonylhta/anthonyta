"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  age,
  formatSize,
  INBOX_PREFIX,
  noteName,
  sanitizePathname,
  type FileKind,
  type InboxFile,
} from "@/lib/files";

// Short type tags for the non-image thumbnail slot.
const KIND_TAG: Record<FileKind, string> = {
  image: "img",
  doc: "doc",
  archive: "zip",
  audio: "aud",
  video: "vid",
  other: "bin",
};

/** The owner-only files inbox: a Warm-Terminal uploader + a disposable file list. */
export function FilesInbox({
  files,
  offline,
}: {
  files: InboxFile[];
  offline: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<{
    name: string;
    pct: number;
  } | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0 || busy) return;
    const chosen = Array.from(list);
    setBusy(true);
    setFailed([]);
    const errored: string[] = [];
    for (const file of chosen) {
      setProgress({ name: file.name, pct: 0 });
      try {
        await upload(INBOX_PREFIX + sanitizePathname(file.name), file, {
          access: "private",
          handleUploadUrl: "/api/files/upload",
          contentType: file.type || undefined,
          onUploadProgress: (e) =>
            setProgress({ name: file.name, pct: Math.round(e.percentage) }),
        });
      } catch {
        errored.push(file.name);
      }
    }
    setProgress(null);
    setFailed(errored);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  async function sendNote() {
    const text = note;
    if (!text.trim() || busy) return;
    setBusy(true);
    setFailed([]);
    setProgress({ name: "note", pct: 0 });
    let ok = true;
    try {
      await upload(
        INBOX_PREFIX + noteName(text),
        new Blob([text], { type: "text/plain" }),
        {
          access: "private",
          handleUploadUrl: "/api/files/upload",
          contentType: "text/plain",
          onUploadProgress: (e) =>
            setProgress({ name: "note", pct: Math.round(e.percentage) }),
        },
      );
    } catch {
      ok = false;
    }
    setProgress(null);
    setBusy(false);
    if (ok) {
      setNote("");
      router.refresh();
    } else {
      setFailed(["note"]);
    }
  }

  return (
    <div className="px-4 py-4">
      {!offline && (
        <div className="mb-4">
          <div className="mb-3 flex items-start gap-2">
            <span className="mt-1.5 font-mono text-sm text-amber">&gt;</span>
            <textarea
              rows={2}
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendNote();
                }
              }}
              placeholder="paste text · enter to send"
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
              <span className="text-amber">+</span> drop files here or choose to
              upload
            </span>
          </label>

          {progress && (
            <p className="mt-2 font-mono text-xs text-muted">
              uploading {progress.name} ·{" "}
              <span className="tabular-nums text-amber">{progress.pct}%</span>
            </p>
          )}

          {failed.map((name) => (
            <p key={name} className="mt-2 text-xs text-down">
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
          {files.map((f) => (
            <FileRow
              key={f.pathname}
              f={f}
              onChanged={() => router.refresh()}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One inbox row — a file (thumbnail, dl · link · del) or an inlined text note (copy · del). */
function FileRow({ f, onChanged }: { f: InboxFile; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [linkLabel, setLinkLabel] = useState("link");
  const [copyLabel, setCopyLabel] = useState("copy");
  const [delError, setDelError] = useState(false);

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

  async function copyLink() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/files/link?p=${encodeURIComponent(f.pathname)}`,
      );
      if (!res.ok) throw new Error("link failed");
      const { url } = await res.json();
      await navigator.clipboard.writeText(url);
      setLinkLabel("copied · 1h");
    } catch {
      setLinkLabel("error");
    } finally {
      setBusy(false);
      setTimeout(() => setLinkLabel("link"), 2000);
    }
  }

  async function remove() {
    setBusy(true);
    setDelError(false);
    try {
      const res = await fetch("/api/files/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pathname: f.pathname }),
      });
      if (!res.ok) throw new Error("delete failed");
      onChanged();
    } catch {
      setDelError(true);
      setBusy(false);
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
              disabled={busy}
              className="text-muted transition-colors hover:text-amber disabled:opacity-30"
            >
              {copyLabel}
            </button>
          ) : (
            <>
              <a
                href={dl}
                download
                className="text-muted transition-colors hover:text-amber"
              >
                dl
              </a>
              <button
                type="button"
                onClick={copyLink}
                disabled={busy}
                className="tabular-nums text-muted transition-colors hover:text-amber disabled:opacity-30"
              >
                {linkLabel}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-muted transition-colors hover:text-down disabled:opacity-30"
          >
            del
          </button>
        </div>
      </div>

      {delError && (
        <p className="mt-1 text-xs text-down">delete failed — try again</p>
      )}
    </li>
  );
}
