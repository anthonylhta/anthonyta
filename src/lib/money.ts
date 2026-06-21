/** Shared money formatting for the finance surfaces (net worth, portfolio). */
export const aud = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

export const tone = (n: number) =>
  n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted";

export const arrow = (n: number) => (n > 0 ? "▲" : n < 0 ? "▼" : "·");
