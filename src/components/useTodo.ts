"use client";

import { useEffect, useState } from "react";
import { useVault } from "@/app/files/useVault";
import { checkSeqAndRemember, rememberSavedSeq } from "@/components/SeqAlarm";
import { TODO_CONTEXT } from "@/lib/aevcontext";
import { randomId } from "@/lib/crypto";
import { nextSeq } from "@/lib/seqrule";
import {
  EMPTY_TODO_CONFIG,
  addItem,
  normalizeTodoConfig,
  type TodoConfig,
} from "@/lib/todo";

export interface Todo {
  /** The decrypted list — non-null once it has been loaded and opened. */
  cfg: TodoConfig | null;
  /** The vault's own state, for the lock-edge resets a surface owns itself. */
  unlocked: boolean;
  /** How the load failed, for the surface to say so in its own register. */
  dataErr: "unreachable" | "tamper" | null;
  seqAlarm: boolean;
  busy: boolean;
  save: (apply: (base: TodoConfig) => TodoConfig) => Promise<boolean>;
  /** Add one capture — the single write every other surface needs. */
  capture: (text: string) => Promise<boolean>;
}

/**
 * The `meta/todo` envelope, as one hook: fetch, decrypt, normalize, and the
 * seal → PUT → retry-once-on-409 save every edit goes through. Two surfaces
 * write the same list now — the homepage board and /reader's save button — and
 * they share this hook precisely so they cannot drift: one load path, one save
 * path, one write counter between them (the useAgenda precedent).
 *
 * Every capture lives in that envelope, so this is client-only machinery: the
 * server moves ciphertext and never sees a line of it. Nothing is held past the
 * lock — the decrypted list leaves the moment the vault does.
 *
 * Failure is reported rather than swallowed: a healthy 404 is first-run, but a
 * tampered envelope or an unreachable store gets its own state, and the surface
 * decides how loudly to say it (the board says it plainly; the reader, where
 * the list is a side errand, just refuses the save).
 *
 * Every save re-applies a PURE transform against freshly-fetched state on a
 * conflict, so capturing on the phone while the PC has a page open can't lose
 * either. This store WRITES, so it owns the rollback check (58b). Nothing is
 * optimistic: a capture is on the list after it is sealed, not before.
 */
export function useTodo(offline: boolean): Todo {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<TodoConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [seqAlarm, setSeqAlarm] = useState(false);
  const [busy, setBusy] = useState(false);

  // Render-phase reset on the lock/unlock edge (the glance idiom): decrypted
  // captures leave with the key. A surface resets its own composer off
  // `unlocked` for the same reason.
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    setCfg(null);
    setDataErr(null);
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
            const { bytes } = await openItem(envelope, TODO_CONTEXT);
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
      // Rollback check (58b) — a 404 for a list this device has seen alarms too.
      void checkSeqAndRemember("todo", config).then((rolled) => {
        if (rolled && !cancelled) setSeqAlarm(true);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  async function putConfig(
    next: TodoConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    // Bump the sealed write counter (58b); prior = the newer of loaded state
    // and next itself (a 409-dance rebuild carries the fresher seq).
    next = { ...next, seq: Math.max(nextSeq(cfg ?? {}), nextSeq(next)) };
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "todo.json", t: "application/json", s: bytes.length },
      bytes,
      TODO_CONTEXT,
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
    if (res.ok) rememberSavedSeq("todo", next);
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<TodoConfig> {
    const res = await fetch("/api/todo");
    if (res.status === 404) return EMPTY_TODO_CONFIG;
    if (res.status !== 200) throw new Error("todo refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope, TODO_CONTEXT);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeTodoConfig(parsed);
    if (!config) throw new Error("todo refetch: bad shape");
    return config;
  }

  /** Apply a pure transform, seal, PUT — retrying once against a fresh config
   *  on a 409 (the other device may have captured meanwhile). */
  async function save(
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

  return {
    cfg,
    unlocked,
    dataErr,
    seqAlarm,
    busy,
    save,
    capture: (text: string) =>
      save((base) => addItem(base, randomId(), text, new Date().toISOString())),
  };
}
