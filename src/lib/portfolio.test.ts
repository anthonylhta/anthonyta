import { describe, expect, it } from "vitest";
import { parseCmcCsv, parseCsvLine } from "./portfolio";

// Synthetic CMC ProfitLoss CSV (fake numbers — the real file is never committed).
const CSV = `"Account Number","Account Name","CHESS HIN","Code","Last","FX Rate","Units Held","Net Avg Price AUD","Cost AUD","Market Value AUD","Day Gain AUD","P&L AUD","P&L %"
"123456","Test User","X#######001","AAA","10.000","","100","9.000","900.00","1000.00","5.00","100.00","11.11"
"123456","Test User","X#######001","BBB","18.000","","50","21.000","1050.00","900.00","-3.00","-150.00","-14.29"
"TOTALS","","","","","","","","1950.00","1900.00","2.00","-50.00","-2.56"`;

describe("parseCsvLine", () => {
  it("handles quoted fields and embedded commas", () => {
    expect(parseCsvLine('"a","b,c","d"')).toEqual(["a", "b,c", "d"]);
  });
});

describe("parseCmcCsv", () => {
  const p = parseCmcCsv(CSV)!;

  it("parses holdings, sorted by value descending", () => {
    expect(p.holdings.map((h) => h.code)).toEqual(["AAA", "BBB"]);
    expect(p.holdings[0].units).toBe(100);
    expect(p.holdings[0].value).toBe(1000);
    expect(p.holdings[1].pnl).toBe(-150);
  });

  it("reads the TOTALS row", () => {
    expect(p.totals.value).toBe(1900);
    expect(p.totals.cost).toBe(1950);
    expect(p.totals.pnl).toBe(-50);
    expect(p.totals.pnlPct).toBeCloseTo(-2.56);
  });

  it("returns null for junk input", () => {
    expect(parseCmcCsv("")).toBeNull();
    expect(parseCmcCsv("not,a,csv")).toBeNull();
  });
});
