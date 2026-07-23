"use client";

import { useEffect, useState } from "react";
import { setCachedKey, touchActivityStamp } from "@/lib/keycache";
import {
  beginRotation,
  completeRotation,
  finishStaleRotation,
  inspectEstate,
  probeRotation,
  resumeRotation,
  RotationHalt,
  type ProbeStatus,
  type PromotionResult,
  type RotationProgress,
} from "@/lib/rotationdriver";
import type { EstatePartition } from "@/lib/rotationset";
import { rotationIo } from "@/app/system/rotationIo";

const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

type View =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "probe"; status: ProbeStatus; estate: EstatePartition | null }
  | { kind: "running"; progress: RotationProgress | null }
  | { kind: "done"; result: PromotionResult }
  | { kind: "halt"; code: string; message: string; keys: string[] };

/**
 * The master-key rotation band (ADR 0090; wiring ADRs 0103–0105). Rotation is
 * deliberately rare and deliberately loud: the estate is inspected up front
 * (unknown keys refuse before the passphrase is even asked for), every step is
 * journaled and resumable, and the engine behind the [rotate] button is the
 * crash-matrix-tested driver — this component only routes clicks and renders
 * progress. Passphrase-only: a passkey tap can't start one (minting the second
 * wrap needs the KEK, which only the passphrase derives).
 */
export function RotationPanel({ offline }: { offline: boolean }) {
  const [view, setView] = useState<View>(
    offline ? { kind: "offline" } : { kind: "loading" },
  );
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (offline) return;
    let cancelled = false;
    (async () => {
      const status = await probeRotation(rotationIo);
      let estate: EstatePartition | null = null;
      if (status === "idle") {
        try {
          estate = await inspectEstate(rotationIo);
        } catch {
          estate = null;
        }
      }
      if (!cancelled) setView({ kind: "probe", status, estate });
    })();
    return () => {
      cancelled = true;
    };
  }, [offline]);

  async function run(mode: "begin" | "resume") {
    if (busy || !pass) return;
    setBusy(true);
    try {
      const s =
        mode === "begin"
          ? await beginRotation(rotationIo, pass)
          : await resumeRotation(rotationIo, pass);
      setPass("");
      setView({ kind: "running", progress: null });
      const result = await completeRotation(rotationIo, s, (p) =>
        setView({ kind: "running", progress: p }),
      );
      // Keep THIS device unlocked across the promotion: the cached key would
      // otherwise fail the new canary at next boot (that failing loudly is the
      // point — on every OTHER device).
      try {
        await setCachedKey(s.mk2);
        await touchActivityStamp();
      } catch {
        // cache refresh is comfort, not correctness — the passphrase re-unlocks
      }
      setView({ kind: "done", result });
    } catch (err) {
      if (err instanceof RotationHalt)
        setView({
          kind: "halt",
          code: err.code,
          message: err.message,
          keys: err.keys,
        });
      else
        setView({
          kind: "halt",
          code: "io",
          message: "the rotation stopped unexpectedly — resume to continue",
          keys: [],
        });
    } finally {
      setBusy(false);
    }
  }

  async function cleanup() {
    if (busy || !pass) return;
    setBusy(true);
    try {
      await finishStaleRotation(rotationIo, pass);
      setPass("");
      setView({ kind: "probe", status: "idle", estate: null });
    } catch (err) {
      if (err instanceof RotationHalt)
        setView({
          kind: "halt",
          code: err.code,
          message: err.message,
          keys: err.keys,
        });
    } finally {
      setBusy(false);
    }
  }

  const passInput = (
    <input
      type="password"
      value={pass}
      onChange={(e) => setPass(e.target.value)}
      placeholder="vault passphrase"
      autoComplete="current-password"
      className="w-44 border border-hairline bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted/50 focus:border-amber"
    />
  );

  return (
    <div className="text-xs">
      {view.kind === "offline" && (
        <p className="text-muted">store offline — rotation unavailable</p>
      )}
      {view.kind === "loading" && <p className="text-muted">probing…</p>}

      {view.kind === "probe" && view.status === "no-vault" && (
        <p className="text-muted">no vault yet — nothing to rotate</p>
      )}
      {view.kind === "probe" && view.status === "error" && (
        <p className="text-red">state unreadable — reload and retry</p>
      )}

      {view.kind === "probe" && view.status === "idle" && (
        <div className="space-y-2">
          <p className="text-muted">
            re-key the whole vault: every sealed blob is re-encrypted under a
            fresh master key, then the old one is retired. slow, resumable,
            refuses to finish unless everything verifies.
          </p>
          {view.estate && view.estate.unknown.length > 0 ? (
            <div className="border border-red/40 px-2 py-1.5 text-red">
              <p>
                {view.estate.unknown.length} unclassified key(s) block rotation
                — remove or classify them first:
              </p>
              <ul className="mt-1 font-mono text-[11px]">
                {view.estate.unknown.slice(0, 8).map((k) => (
                  <li key={k}>{k}</li>
                ))}
                {view.estate.unknown.length > 8 && (
                  <li>+{view.estate.unknown.length - 8} more</li>
                )}
              </ul>
            </div>
          ) : (
            <>
              {view.estate && (
                <p className="text-muted/70">
                  {view.estate.walk.length} blobs to re-seal ·{" "}
                  {view.estate.skipped.length} skipped (not key-sealed)
                </p>
              )}
              <p className="text-amber/80">
                afterwards: every passkey must re-enroll, printed recovery
                shares are dead until re-split, and other devices will ask for
                the passphrase again.
              </p>
              <div className="flex items-center gap-2">
                {passInput}
                <button
                  type="button"
                  className={btn}
                  disabled={busy || !pass || view.estate === null}
                  onClick={() => run("begin")}
                >
                  rotate master key
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {view.kind === "probe" && view.status === "in-flight" && (
        <div className="space-y-2">
          <p className="text-amber/80">
            a rotation is in flight — resume it (progress is journaled; it
            continues from the exact blob it stopped at).
          </p>
          <div className="flex items-center gap-2">
            {passInput}
            <button
              type="button"
              className={btn}
              disabled={busy || !pass}
              onClick={() => run("resume")}
            >
              resume rotation
            </button>
          </div>
        </div>
      )}

      {view.kind === "probe" && view.status === "stale-journal" && (
        <div className="space-y-2">
          <p className="text-amber/80">
            a finished rotation left cleanup behind (promotion completed; the
            journal and old passkey wraps remain).
          </p>
          <div className="flex items-center gap-2">
            {passInput}
            <button
              type="button"
              className={btn}
              disabled={busy || !pass}
              onClick={cleanup}
            >
              finish cleanup
            </button>
          </div>
        </div>
      )}

      {view.kind === "running" && (
        <div className="space-y-1">
          <p className="text-amber">
            rotating — do not close this tab (safe to, but you&apos;ll resume by
            hand)
          </p>
          {view.progress ? (
            <p className="font-mono text-[11px] text-muted">
              {view.progress.phase} {view.progress.done + 1}/
              {view.progress.total} ·{" "}
              {view.progress.key.length > 42
                ? `${view.progress.key.slice(0, 42)}…`
                : view.progress.key}
            </p>
          ) : (
            <p className="text-muted">preparing…</p>
          )}
        </div>
      )}

      {view.kind === "done" && (
        <div className="space-y-2">
          <p className="text-green">
            rotation complete — every blob now opens only under the new master
            key.
          </p>
          {(!view.result.prfDropped || !view.result.journalDeleted) && (
            <p className="text-amber/80">
              cleanup didn&apos;t finish — reload this page and use “finish
              cleanup”.
            </p>
          )}
          <ul className="list-inside list-disc text-muted">
            <li>
              re-enroll each device&apos;s passkey in <b>access</b> above (old
              wraps were dropped — one tap per device)
            </li>
            <li>
              re-split and re-print recovery shares in <b>access</b> (the paper
              ones encode the retired key)
            </li>
            <li>other devices will ask for the passphrase on next use</li>
            <li>
              run <span className="font-mono">npm run hub-backup</span> — the
              last backup&apos;s ciphertext is under the old key
            </li>
          </ul>
        </div>
      )}

      {view.kind === "halt" && (
        <div className="space-y-1">
          <p className="text-red">stopped: {view.message}</p>
          {view.keys.length > 0 && (
            <ul className="font-mono text-[11px] text-muted">
              {view.keys.slice(0, 8).map((k) => (
                <li key={k}>{k}</li>
              ))}
              {view.keys.length > 8 && <li>+{view.keys.length - 8} more</li>}
            </ul>
          )}
          <p className="text-muted">
            nothing was lost — the journal holds progress. reload to resume.
          </p>
        </div>
      )}
    </div>
  );
}
