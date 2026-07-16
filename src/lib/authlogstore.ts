import {
  appendEntry,
  emptyLog,
  isAuthLog,
  type AuthEventKind,
  type AuthLog,
} from "./authlog";
import { r2Enabled, readKey, writeKey, type StoreRead } from "./r2";

/**
 * authlogstore — the guarded R2 I/O layer for the hash-chained auth journal
 * (ADR: auth journal). This is the rare record the SERVER writes, so it isn't
 * E2EE and doesn't need to be — entries carry no secrets. Its integrity story
 * is the chain itself (`lib/authlog`): the server can append honestly or break
 * the chain visibly; it cannot edit history and have the chain still verify,
 * and the panel's device-side tip memory catches truncation and full rewrites.
 *
 * Like every store module it degrades rather than throws: no `R2_*` env →
 * appends no-op and reads report "error".
 */

export const AUTHLOG_PATH = "meta/authlog";

/** Read the raw journal JSON, three-state (absent = genuinely never written). */
export async function getAuthLog(): Promise<StoreRead<string>> {
  const read = await readKey(AUTHLOG_PATH);
  if (read.state !== "ok") return read;
  return { state: "ok", value: new TextDecoder().decode(read.value) };
}

/** Overwrite the journal. `true` on success; never surfaces the error. */
export async function putAuthLog(json: string): Promise<boolean> {
  const wrote = await writeKey(AUTHLOG_PATH, json, {
    overwrite: true,
    contentType: "application/json",
  });
  return wrote === "ok";
}

/**
 * Journal one security event — fire-and-forget in the sense that it NEVER
 * throws and never blocks the caller's verdict: availability beats
 * completeness here (a journal hiccup must not fail a legitimate sign-in).
 *
 * The error-not-absent discipline is load-bearing twice over:
 *  - a flaky READ treated as absent would restart the chain at seq 1 — the
 *    truncation attack, self-inflicted — so an error read skips the append;
 *  - an EXISTING-but-unreadable log is evidence (the panel raises the alarm);
 *    appending a fresh chain over it would destroy exactly what needs seeing.
 *
 * Two simultaneous events race this read-modify-write; last-writer-wins can
 * drop one entry. Acceptable for a one-owner system — each writer re-reads the
 * tip, so the surviving chain is always valid.
 */
export async function recordAuthEvent(
  kind: AuthEventKind,
  detail: string,
): Promise<void> {
  try {
    if (!r2Enabled()) return;
    const read = await getAuthLog();
    if (read.state === "error") {
      console.error("[authlog] read failed — event not journaled:", kind);
      return;
    }
    let log: AuthLog;
    if (read.state === "absent") {
      log = emptyLog();
    } else {
      try {
        const parsed: unknown = JSON.parse(read.value);
        if (!isAuthLog(parsed)) throw new Error("bad shape");
        log = parsed;
      } catch {
        console.error(
          "[authlog] journal unreadable — event not journaled (overwriting would destroy the evidence):",
          kind,
        );
        return;
      }
    }
    const next = await appendEntry(log, {
      kind,
      detail,
      ts: new Date().toISOString(),
    });
    if (!(await putAuthLog(JSON.stringify(next))))
      console.error("[authlog] write failed — event not journaled:", kind);
  } catch (err) {
    console.error("[authlog] append failed:", err);
  }
}
