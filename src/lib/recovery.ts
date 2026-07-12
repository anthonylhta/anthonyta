/**
 * recovery — the pure, dependency-free half of Shamir paper recovery: take the
 * pasted share payloads and turn them into a candidate secret, or a precise reason
 * why not. It carries NO cryptography of its own — SSS is silent about wrong shares,
 * so a value returned here is only a CANDIDATE. The recovery flow's real integrity
 * gate is opening an existing master-key-sealed envelope with the reconstructed key;
 * this helper just rejects the input that can't even be a valid reconstruction
 * (damaged checksum, mixed splits, too few shares) before that GCM check runs.
 */

import { combine, parseShare, type Share } from "./shamir";

export type ReconstructResult =
  | { ok: true; secret: Uint8Array; threshold: number; used: number }
  | { ok: false; error: string };

/**
 * Parse + reconstruct from pasted payloads. Each entry is one share's text; blanks
 * are ignored so a textarea split on newlines drops in directly. A damaged/mistyped
 * share (failed checksum, wrong version) names its 1-based position; shares must all
 * declare the same threshold, and there must be at least that many. Returns a
 * candidate secret — never trusted until the caller's envelope check confirms it.
 */
export function reconstructSecret(payloads: string[]): ReconstructResult {
  const cleaned = payloads.map((p) => p.trim()).filter((p) => p.length > 0);
  if (cleaned.length === 0)
    return { ok: false, error: "paste at least one share" };

  const parsed: { share: Share; threshold: number }[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const p = parseShare(cleaned[i]);
    if (!p) return { ok: false, error: `share ${i + 1} looks damaged` };
    parsed.push(p);
  }

  const threshold = parsed[0].threshold;
  if (parsed.some((p) => p.threshold !== threshold))
    return { ok: false, error: "shares are from different splits" };

  const xs = new Set<number>();
  for (let i = 0; i < parsed.length; i++) {
    if (xs.has(parsed[i].share.x))
      return { ok: false, error: `share ${i + 1} is a duplicate` };
    xs.add(parsed[i].share.x);
  }

  if (parsed.length < threshold)
    return {
      ok: false,
      error: `need ${threshold} shares to recover — have ${parsed.length}`,
    };

  // Exactly `threshold` points define the polynomial; more of the same split are
  // consistent, but combining the minimal set keeps the result deterministic.
  const subset = parsed.slice(0, threshold).map((p) => p.share);
  try {
    return {
      ok: true,
      secret: combine(subset),
      threshold,
      used: subset.length,
    };
  } catch {
    // Structurally impossible input the checks above didn't catch (e.g. mismatched
    // share lengths from two different secrets that shared a threshold).
    return { ok: false, error: "these shares don't fit together" };
  }
}
