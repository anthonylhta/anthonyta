/** Shared money formatting for the finance surfaces (net worth, portfolio). */
export const aud = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

export const tone = (n: number) =>
  n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted";

export const arrow = (n: number) => (n > 0 ? "▲" : n < 0 ? "▼" : "·");

/**
 * The same figure at a glance's width — `$5.3k`, `$1.2M`. Under a thousand there
 * is nothing to shorten, so it reads in full: a one-line row has room for `$840.00`
 * and `$0.8k` would only cost precision.
 */
export const audCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs < 1_000) return aud(n);
  const sign = n < 0 ? "-" : "";
  if (abs < 1_000_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
};
