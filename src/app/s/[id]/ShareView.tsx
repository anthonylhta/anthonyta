"use client";

import { useEffect, useState } from "react";
import { fromB64url, importShareKey, open } from "@/lib/crypto";
import { formatSize } from "@/lib/files";
import {
  buildHandoff,
  handoffSlot,
  parseKeyFragment,
  readHandoff,
  stripFragment,
} from "@/lib/fragkey";

type State =
  | { kind: "loading" }
  /** No usable key: fragment absent/malformed AND no live handoff (truncated
   *  copy, or a stripped URL reopened after the handoff died). */
  | { kind: "nokey" }
  /** The ciphertext is gone (expired past its TTL, or deleted). */
  | { kind: "gone" }
  /** The key doesn't open the ciphertext — a damaged link or wrong fragment. */
  | { kind: "corrupt" }
  | { kind: "ready"; name: string; size: number; type: string; url: string };

const COPY: Record<"nokey" | "gone" | "corrupt", string> = {
  nokey:
    "this link is missing its key — copy the whole link and try again. if you opened it before, links only stay unlocked for a short while.",
  gone: "this link has expired or was removed.",
  corrupt: "couldn't unlock this file — the link may be damaged.",
};

/** sessionStorage can be blocked (private mode) or full — the handoff is a
 *  reload nicety, never a requirement, so both sides swallow storage throws. */
function parkKey(id: string, key: string): void {
  try {
    sessionStorage.setItem(handoffSlot(id), buildHandoff(key, Date.now()));
  } catch {
    /* the fragment already decrypted this visit; only reload loses out */
  }
}

function parkedKey(id: string): string | null {
  try {
    return readHandoff(sessionStorage.getItem(handoffSlot(id)), Date.now());
  } catch {
    return null;
  }
}

/**
 * The recipient side of a share link. The key arrives in the URL fragment
 * (never sent to the server), is captured ONCE and stripped from the history
 * entry, then parked in a short-lived same-tab handoff (lib/fragkey) so a
 * reload still decrypts — after first paint, history holds only the bare
 * `/s/<id>`. We import the key, pull the same-origin ciphertext, and decrypt
 * in-browser. Decrypting on the main thread is fine here — one small file, and
 * no worker to ship on a public page.
 */
export function ShareView({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      // Capture-then-strip, BEFORE any await: the fragment must be gone from
      // the history entry before anything can navigate, throw, or suspend —
      // otherwise the key persists in history (and syncs) key-and-all. The
      // parked copy is what lets a same-tab reload still decrypt.
      const fromFragment = parseKeyFragment(location.hash);
      if (fromFragment !== null) {
        history.replaceState(null, "", stripFragment(location.href));
        parkKey(id, fromFragment);
      }
      // A malformed fragment (truncated copy) parses as null and falls through
      // to the handoff — absent that too, it reads as "missing its key", the
      // message that actually helps.
      const raw = fromFragment ?? parkedKey(id);
      if (raw === null) {
        if (!cancelled) setState({ kind: "nokey" });
        return;
      }
      try {
        const key = await importShareKey(fromB64url(raw));
        const res = await fetch(`/api/share/${id}`);
        if (!res.ok) {
          if (!cancelled) setState({ kind: "gone" });
          return;
        }
        const envelope = new Uint8Array(await res.arrayBuffer());
        // A wrong/damaged key fails open()'s GCM auth check — that throw is the
        // "this link is broken" verdict, caught below as "corrupt".
        const { meta, bytes } = await open(key, envelope);
        const url = URL.createObjectURL(
          new Blob([bytes as BlobPart], {
            type: meta.t || "application/octet-stream",
          }),
        );
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setState({
          kind: "ready",
          name: meta.n,
          size: meta.s,
          type: meta.t,
          url,
        });
      } catch {
        if (!cancelled) setState({ kind: "corrupt" });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (state.kind === "loading") {
    return (
      <p className="flex items-center gap-2 font-mono text-xs text-muted">
        <span className="animate-pulse text-amber">▍</span> decrypting…
      </p>
    );
  }

  if (state.kind !== "ready") {
    return <p className="font-mono text-xs text-down">{COPY[state.kind]}</p>;
  }

  // No inline preview, even for images: the strict CSP omits `blob:` from
  // img-src, so a rendered <img src={objectUrl}> would be blocked. Download only.
  return (
    <div className="font-mono">
      <p className="truncate text-[13px] text-fg">{state.name}</p>
      <p className="mt-1 text-xs text-muted">{formatSize(state.size)}</p>
      <a
        href={state.url}
        download={state.name}
        className="mt-4 inline-block border border-hairline px-3 py-1.5 text-xs text-amber transition-colors hover:bg-amber hover:text-bg"
      >
        download
      </a>
    </div>
  );
}
