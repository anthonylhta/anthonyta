"use client";

import { useEffect, useRef, useState } from "react";
import { boxSeal, fromB64url, toB64url } from "@/lib/crypto";
import { buildMessage, MAX_BODY_CHARS, MAX_CONTACT_CHARS } from "@/lib/dropbox";
import { POW_BITS, solve } from "@/lib/pow";

// Shared input/button idioms, matching the finance panel.
const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

type Phase = "idle" | "sealing" | "proving" | "sent" | "error";

/**
 * The public "leave me a private message" composer (ADR: sealed box, resurrected).
 * The message is sealed IN THIS BROWSER to the owner's published public key, so the
 * server only ever stores ciphertext it can never read. A small proof-of-work stands
 * in for a third-party CAPTCHA — no tracking widget, no new origin. The whole form
 * hides itself when the box isn't enabled (no published key → guarded degrade).
 */
export function DropBox() {
  // undefined = still probing, null = box disabled (hide), Uint8Array = the pub point.
  const [pub, setPub] = useState<Uint8Array | null | undefined>(undefined);
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Probe for the owner's public key once. A 404 (box off / store off) hides the
  // form entirely — the same guarded degrade every connector uses.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dropbox/pubkey");
        if (!res.ok) {
          if (!cancelled) setPub(null);
          return;
        }
        const { pub_b64 } = (await res.json()) as { pub_b64?: string };
        if (cancelled) return;
        setPub(typeof pub_b64 === "string" ? fromB64url(pub_b64) : null);
      } catch {
        if (!cancelled) setPub(null);
      }
    })();
    return () => {
      cancelled = true;
      // A solve in flight when the page unmounts is abandoned, not leaked.
      abortRef.current?.abort();
    };
  }, []);

  if (pub === undefined || pub === null) return null;
  const pubRaw = pub;

  async function submit() {
    if (phase === "sealing" || phase === "proving") return;
    setErr(null);

    const built = buildMessage(body, contact, new Date().toISOString());
    if (!built.ok) {
      setErr(
        built.error === "empty"
          ? "write a message first"
          : built.error === "too-long"
            ? `message is too long (max ${MAX_BODY_CHARS})`
            : `contact is too long (max ${MAX_CONTACT_CHARS})`,
      );
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setPhase("sealing");
      const bytes = new TextEncoder().encode(JSON.stringify(built.message));
      const envelope = await boxSeal(pubRaw, bytes);

      // Proof-of-work over the exact ciphertext — a beat on a phone, and the spam
      // gate that lets the ingest route stay stateless.
      setPhase("proving");
      const nonce = await solve(envelope, POW_BITS, controller.signal);

      const res = await fetch("/api/dropbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelope_b64: toB64url(envelope), nonce }),
      });
      if (!res.ok) throw new Error("post failed");
      setPhase("sent");
      setBody("");
      setContact("");
    } catch (e) {
      if (e instanceof Error && e.message === "aborted") return; // unmounted
      setPhase("error");
      setErr("could not send — try again");
    } finally {
      abortRef.current = null;
    }
  }

  const busy = phase === "sealing" || phase === "proving";

  if (phase === "sent") {
    return (
      <div className="border-t border-hairline px-4 py-8">
        <p className="text-sm text-amber">message sealed and sent ✓</p>
        <p className="mt-2 text-xs text-muted">
          it landed as ciphertext only i can open. thanks for reaching out.
        </p>
        <button
          type="button"
          onClick={() => setPhase("idle")}
          className={`mt-3 ${btn}`}
        >
          send another
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-hairline px-4 py-8">
      <p className="text-sm text-muted">
        <span className="text-amber">&gt;</span>{" "}
        <span className="text-fg">leave a private message</span>
      </p>
      <p className="mt-2 text-xs text-muted">
        sealed in your browser to my public key — the server stores ciphertext
        it can never read.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <textarea
          value={body}
          disabled={busy}
          onChange={(e) => setBody(e.target.value)}
          placeholder="your message"
          rows={5}
          maxLength={MAX_BODY_CHARS}
          className={`${input} resize-y`}
        />
        <input
          value={contact}
          disabled={busy}
          onChange={(e) => setContact(e.target.value)}
          placeholder="how to reach you back (optional)"
          maxLength={MAX_CONTACT_CHARS}
          className={input}
        />
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className={btn}
          >
            {phase === "sealing"
              ? "sealing…"
              : phase === "proving"
                ? "proving you're human…"
                : "seal + send"}
          </button>
          {busy && (
            <span className="text-muted/60">
              this runs on your device — nothing leaves until it is encrypted
            </span>
          )}
        </div>
        {err && <p className="text-xs text-down">{err}</p>}
      </div>
    </div>
  );
}
