"use client";

import { useEffect, useState } from "react";
import {
  CENTER_MODULES,
  EMPTY_LAYOUT,
  LOBBY_MODULES,
  hiddenSet,
  normalizeLayout,
  setHidden,
  type LayoutConfig,
  type Surface,
} from "@/lib/layout";

const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

type Phase = "loading" | "ready" | "unreachable";

/**
 * The /system layout panel (roadmap 59, v1: visibility only) — terminal-style
 * `[x]` toggles for every module on the two adaptive surfaces. Save PUTs the
 * plaintext config and the render cache revalidates, so the change is live on
 * the next page load — including for guests on the lobby.
 */
export function LayoutPanel({ offline }: { offline: boolean }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [cfg, setCfg] = useState<LayoutConfig>(EMPTY_LAYOUT);
  const [savedCfg, setSavedCfg] = useState<LayoutConfig>(EMPTY_LAYOUT);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<"saved" | "failed" | null>(null);

  useEffect(() => {
    if (offline) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/layout");
        if (!res.ok) throw new Error(`layout: ${res.status}`);
        const parsed = normalizeLayout(await res.json()) ?? EMPTY_LAYOUT;
        if (cancelled) return;
        setCfg(parsed);
        setSavedCfg(parsed);
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
        layout store unreachable — reload to retry
      </p>
    );

  const dirty = JSON.stringify(cfg) !== JSON.stringify(savedCfg);

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch("/api/layout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error(`save: ${res.status}`);
      setSavedCfg(cfg);
      setNote("saved");
    } catch {
      setNote("failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <SurfaceToggles
        title="lobby — the public face"
        surface="lobby"
        cfg={cfg}
        onChange={setCfg}
      />
      <SurfaceToggles
        title="command center — private"
        surface="center"
        cfg={cfg}
        onChange={setCfg}
      />
      <div className="flex items-center gap-3">
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

function SurfaceToggles({
  title,
  surface,
  cfg,
  onChange,
}: {
  title: string;
  surface: Surface;
  cfg: LayoutConfig;
  onChange: (next: LayoutConfig) => void;
}) {
  const defs = surface === "lobby" ? LOBBY_MODULES : CENTER_MODULES;
  const hidden = hiddenSet(cfg, surface);
  return (
    <div>
      <p className="mb-1.5 text-[11px] uppercase tracking-[0.15em] text-muted">
        {title}
      </p>
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {defs.map((m) => {
          const visible = !hidden.has(m.key);
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onChange(setHidden(cfg, surface, m.key, visible))}
              aria-pressed={visible}
              className={`py-1 text-left text-[13px] transition-colors hover:text-amber ${
                visible ? "text-fg" : "text-muted/60"
              }`}
            >
              <span className="tabular-nums">[{visible ? "x" : " "}]</span>{" "}
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
