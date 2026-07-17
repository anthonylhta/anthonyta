"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import { randomId } from "@/lib/crypto";
import {
  EMPTY_TODO_CONFIG,
  addItem,
  clearDone,
  doneCount,
  normalizeTodoConfig,
  openItems,
  setDone,
  setPinned,
  type TodoConfig,
} from "@/lib/todo";

const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

/** How many open items the glance shows before "show all". */
const GLANCE_COUNT = 6;

/**
 * Quick capture — the command center's E2EE todo list (roadmap 53). Captures
 * seal into the `meta/todo` envelope in the browser; the server stores
 * ciphertext it never parses. Renders sealed dots until the vault key is in
 * hand (the IDB cache usually means it already is), and drops the decrypted
 * list the moment the vault locks. Every save is the fin panel's
 * seal → PUT → retry-once-on-409 dance, so two devices can capture at once.
 */
export function TodoGlance({ offline }: { offline: boolean }) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<TodoConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Render-phase reset on the lock/unlock edge (the glance idiom): decrypted
  // captures leave with the key.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setCfg(null);
    setDataErr(null);
    setShowAll(false);
  }

  // Load + decrypt once per unlock. A healthy 404 is first-run; anything else
  // must never look like it (the keystore lesson).
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      let config: TodoConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/todo");
        if (res.status === 404) {
          config = EMPTY_TODO_CONFIG;
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeTodoConfig(parsed);
            if (!config) throw new Error("bad shape");
            existed = true;
          } catch {
            if (!cancelled) setDataErr("tamper");
            return;
          }
        } else {
          if (!cancelled) setDataErr("unreachable");
          return;
        }
      } catch {
        if (!cancelled) setDataErr("unreachable");
        return;
      }
      if (cancelled) return;
      setCfg(config);
      setConfigExisted(existed);
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  async function putConfig(
    next: TodoConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "todo.json", t: "application/json", s: bytes.length },
      bytes,
    );
    const res = await fetch("/api/todo", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-todo-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<TodoConfig> {
    const res = await fetch("/api/todo");
    if (res.status === 404) return EMPTY_TODO_CONFIG;
    if (res.status !== 200) throw new Error("todo refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeTodoConfig(parsed);
    if (!config) throw new Error("todo refetch: bad shape");
    return config;
  }

  /** Apply a pure transform, seal, PUT — retrying once against a fresh config
   *  on a 409 (the other device may have captured meanwhile). */
  async function saveConfig(
    apply: (base: TodoConfig) => TodoConfig,
  ): Promise<boolean> {
    if (!cfg) return false;
    setBusy(true);
    try {
      let base = cfg;
      let result = await putConfig(apply(base), configExisted);
      if (result === "conflict") {
        base = await fetchConfigFresh();
        result = await putConfig(apply(base), true);
      }
      if (result !== "ok") return false;
      setCfg(apply(base));
      setConfigExisted(true);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function capture() {
    const t = text.trim();
    if (!t || busy) return;
    const ok = await saveConfig((base) =>
      addItem(base, randomId(), t, new Date().toISOString()),
    );
    if (ok) setText("");
  }

  // --- render ---

  if (!unlocked || !cfg) {
    return (
      <p className="text-xs text-muted">
        {dataErr === "unreachable" ? (
          <span className="text-down">vault unreachable — reload to retry</span>
        ) : dataErr === "tamper" ? (
          <span className="text-down">cannot decrypt — lock and unlock</span>
        ) : unlocked ? (
          "decrypting…"
        ) : (
          <>
            <span className="text-muted/40">·····</span> sealed —{" "}
            <Link href="/files" className="text-amber hover:underline">
              unlock in files →
            </Link>
          </>
        )}
      </p>
    );
  }

  const open = openItems(cfg);
  const shown = showAll ? open : open.slice(0, GLANCE_COUNT);
  const hiddenCount = open.length - shown.length;
  const done = doneCount(cfg);

  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void capture()}
          placeholder="capture…"
          enterKeyHint="done"
          className={`min-w-0 flex-1 ${input}`}
          aria-label="new capture"
        />
        <button
          type="button"
          className={btn}
          disabled={busy || !text.trim()}
          onClick={() => void capture()}
        >
          {busy ? "…" : "add"}
        </button>
      </div>

      {open.length === 0 ? (
        <p className="py-1 text-xs text-muted">nothing captured — type above</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((item) => (
            <li key={item.id} className="flex items-baseline gap-2 py-1">
              <button
                type="button"
                title="mark done"
                disabled={busy}
                onClick={() =>
                  void saveConfig((b) => setDone(b, item.id, true))
                }
                className="shrink-0 tabular-nums text-muted transition-colors hover:text-up"
              >
                [ ]
              </button>
              <span className="min-w-0 flex-1 break-words text-fg/90">
                {item.text}
              </span>
              <button
                type="button"
                title={item.pinned ? "unpin" : "pin to top"}
                disabled={busy}
                onClick={() =>
                  void saveConfig((b) => setPinned(b, item.id, !item.pinned))
                }
                className={`shrink-0 transition-colors ${
                  item.pinned ? "text-amber" : "text-muted/40 hover:text-amber"
                }`}
              >
                *
              </button>
            </li>
          ))}
        </ul>
      )}

      {(hiddenCount > 0 || showAll || done > 0) && (
        <div className="flex items-center gap-4 text-xs text-muted">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="transition-colors hover:text-amber"
            >
              + {hiddenCount} more ▸
            </button>
          )}
          {showAll && open.length > GLANCE_COUNT && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="transition-colors hover:text-amber"
            >
              ▴ show fewer
            </button>
          )}
          {done > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveConfig(clearDone)}
              className="transition-colors hover:text-amber"
            >
              {done} done · clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
