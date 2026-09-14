"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DEFAULT_NOW,
  MAX_NOW_KEY,
  MAX_NOW_LINES,
  MAX_NOW_TEXT,
  normalizeNow,
  type NowLine,
} from "@/lib/now";

const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";
const field =
  "border border-hairline bg-transparent px-2 py-1 text-[13px] text-fg outline-none transition-colors placeholder:text-muted/40 focus:border-amber";

type Phase = "loading" | "ready" | "unreachable";

/**
 * The /system "now" panel — the words the public front door leads with, edited
 * as text instead of shipped as code (lib/now). Same shape as the layout panel
 * beside it: GET on mount, edit locally, save PUTs the plaintext block, and the
 * render cache revalidates so the lobby says the new thing on the next load.
 *
 * The caps are enforced by the inputs themselves rather than by a validator
 * afterwards — a key is twelve characters because the card's left column is
 * twelve characters wide, and a line the store would refuse should be a line
 * that cannot be typed.
 */
export function NowPanel({ offline }: { offline: boolean }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [lines, setLines] = useState<NowLine[]>([]);
  const [savedLines, setSavedLines] = useState<NowLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<"saved" | "failed" | null>(null);

  useEffect(() => {
    if (offline) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/now");
        if (!res.ok) throw new Error(`now: ${res.status}`);
        const cfg = normalizeNow(await res.json()) ?? DEFAULT_NOW;
        if (cancelled) return;
        setLines(cfg.lines);
        setSavedLines(cfg.lines);
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offline]);

  if (offline) {
    return (
      <p className="text-xs text-muted">
        store offline — set the R2_* env vars
      </p>
    );
  }
  if (phase === "loading")
    return <p className="text-xs text-muted">loading…</p>;
  if (phase === "unreachable")
    return (
      <p className="text-xs text-down">
        now store unreachable — reload to retry
      </p>
    );

  const dirty = JSON.stringify(lines) !== JSON.stringify(savedLines);

  function edit(i: number, patch: Partial<NowLine>) {
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch("/api/now", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          v: 1,
          lines,
          // The stamp is the SAVE, not the typing — it is what the card prints.
          updatedAt: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`save: ${res.status}`);
      setSavedLines(lines);
      setNote("saved");
    } catch {
      setNote("failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.15em] text-muted">
          now — the front door&apos;s block
        </p>
        <Link
          href="/?preview=lobby"
          className="text-xs text-amber hover:underline"
        >
          preview lobby ↗
        </Link>
      </div>

      <div className="flex flex-col gap-1.5">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={line.key}
              maxLength={MAX_NOW_KEY}
              aria-label={`line ${i + 1} key`}
              placeholder="key"
              onChange={(e) => edit(i, { key: e.target.value })}
              className={`w-24 shrink-0 ${field}`}
            />
            <input
              value={line.text}
              maxLength={MAX_NOW_TEXT}
              aria-label={`line ${i + 1} text`}
              placeholder="what I am doing"
              onChange={(e) => edit(i, { text: e.target.value })}
              className={`min-w-0 flex-1 ${field}`}
            />
            <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted">
              {line.text.length}/{MAX_NOW_TEXT}
            </span>
            <button
              type="button"
              aria-label={`remove line ${i + 1}`}
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
              className="shrink-0 px-1 leading-none text-muted transition-colors hover:text-down"
            >
              ×
            </button>
          </div>
        ))}
        {lines.length === 0 && (
          <p className="text-xs text-muted">
            no lines — the lobby shows the defaults
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className={btn}
          disabled={lines.length >= MAX_NOW_LINES}
          onClick={() => setLines([...lines, { key: "", text: "" }])}
        >
          + line
        </button>
        <button
          type="button"
          className={btn}
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? "saving…" : "save"}
        </button>
        {dirty && !saving && (
          <span className="text-xs text-amber">unsaved changes</span>
        )}
        {note === "saved" && !dirty && (
          <span className="text-xs text-up">saved — live on next load</span>
        )}
        {note === "failed" && (
          <span className="text-xs text-down">save failed — try again</span>
        )}
      </div>
    </div>
  );
}
