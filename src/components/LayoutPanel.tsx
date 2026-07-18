"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  EMPTY_LAYOUT,
  canMove,
  hiddenSet,
  moveUnit,
  normalizeLayout,
  orderedUnits,
  setHidden,
  type LayoutConfig,
  type Surface,
  type UnitDef,
  type Zone,
} from "@/lib/layout";

const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";
const arrow =
  "px-1 leading-none text-muted transition-colors hover:text-amber disabled:opacity-20 disabled:hover:text-muted";

type Phase = "loading" | "ready" | "unreachable";

/** Zone sections for the command center (in render order); the lobby is one flow. */
const CENTER_ZONES: { zone: Zone; label: string }[] = [
  { zone: "fixed", label: "pinned" },
  { zone: "today", label: "today" },
  { zone: "week", label: "this week" },
];

/**
 * The /system layout panel (roadmap 59) — terminal-style controls for the two
 * adaptive surfaces: an `[x]` toggle to hide each module, and ▲▼ arrows to
 * reorder blocks WITHIN a zone (the command center's `pinned` row and grouped
 * blocks move as a unit; the lobby is one flow). Save PUTs the plaintext config
 * and the render cache revalidates, so the change is live on the next page load
 * — including for guests on the lobby. "preview lobby" opens the guest view.
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
    <div className="flex flex-col gap-4 text-sm">
      <SurfaceEditor
        title="lobby — the public face"
        surface="lobby"
        cfg={cfg}
        onChange={setCfg}
        extra={
          <Link
            href="/?preview=lobby"
            className="text-xs text-amber hover:underline"
          >
            preview lobby ↗
          </Link>
        }
      />
      <SurfaceEditor
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

function SurfaceEditor({
  title,
  surface,
  cfg,
  onChange,
  extra,
}: {
  title: string;
  surface: Surface;
  cfg: LayoutConfig;
  onChange: (next: LayoutConfig) => void;
  extra?: React.ReactNode;
}) {
  const units = orderedUnits(cfg, surface);
  // The command center groups its rows by zone; the lobby is a single flow.
  const sections =
    surface === "center"
      ? CENTER_ZONES.map((z) => ({
          label: z.label as string | null,
          units: units.filter((u) => u.zone === z.zone),
        })).filter((s) => s.units.length > 0)
      : [{ label: null as string | null, units }];

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.15em] text-muted">
          {title}
        </p>
        {extra}
      </div>
      <div className="flex flex-col gap-1">
        {sections.map((s, i) => (
          <div key={i}>
            {s.label && (
              <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted/60">
                {s.label}
              </p>
            )}
            {s.units.map((u) => (
              <UnitRow
                key={u.key}
                surface={surface}
                unit={u}
                cfg={cfg}
                onChange={onChange}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function UnitRow({
  surface,
  unit,
  cfg,
  onChange,
}: {
  surface: Surface;
  unit: UnitDef;
  cfg: LayoutConfig;
  onChange: (next: LayoutConfig) => void;
}) {
  const hidden = hiddenSet(cfg, surface);
  const reorderable = unit.zone !== "fixed";
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="flex shrink-0 items-center pt-0.5">
        {reorderable ? (
          <>
            <button
              type="button"
              aria-label={`move ${unit.label} up`}
              className={arrow}
              disabled={!canMove(cfg, surface, unit.key, -1)}
              onClick={() => onChange(moveUnit(cfg, surface, unit.key, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`move ${unit.label} down`}
              className={arrow}
              disabled={!canMove(cfg, surface, unit.key, 1)}
              onClick={() => onChange(moveUnit(cfg, surface, unit.key, 1))}
            >
              ↓
            </button>
          </>
        ) : (
          <span className="px-1 text-muted/25" title="pinned — not reorderable">
            ·
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5">
        {unit.modules.map((m) => {
          const visible = !hidden.has(m.key);
          return (
            <button
              key={m.key}
              type="button"
              aria-pressed={visible}
              onClick={() => onChange(setHidden(cfg, surface, m.key, visible))}
              className={`text-left text-[13px] transition-colors hover:text-amber ${
                visible ? "text-fg" : "text-muted/60"
              }`}
            >
              <span className="tabular-nums">[{visible ? "x" : " "}]</span>{" "}
              {m.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}
