/**
 * Cash + HISA balances (AUD) from env — the non-invested side of net worth.
 * They change rarely, so the source is config (`CASH_AUD`, `HISA_AUD`,
 * `HISA_RATE`), set on Vercel; never in the public repo. Unset → 0 / null, so the
 * dashboard just shows the invested portfolio until the values are set.
 */
export interface Cash {
  cash: number;
  hisa: number;
  rate: number | null; // HISA % p.a.
}

export function getCash(): Cash {
  const n = (key: string): number => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  };
  const rate = Number(process.env.HISA_RATE);
  return {
    cash: n("CASH_AUD"),
    hisa: n("HISA_AUD"),
    rate: Number.isFinite(rate) && rate > 0 ? rate : null,
  };
}
