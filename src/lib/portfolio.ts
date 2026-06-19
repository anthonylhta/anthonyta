// Parser for the CMC Markets "ProfitLoss" CSV export. The columns we use:
//   Code · Last · Units Held · Net Avg Price AUD · Cost AUD · Market Value AUD
//   · Day Gain AUD · P&L AUD · P&L %
// Plus a TOTALS row. Account number / name / CHESS HIN are ignored. Pure +
// unit-tested; the connector feeds it the file contents (ADR 0012).

export interface Holding {
  code: string;
  units: number;
  last: number;
  value: number; // Market Value AUD
  cost: number; // Cost AUD
  dayGain: number; // Day Gain AUD
  pnl: number; // P&L AUD
  pnlPct: number; // P&L %
}

export interface Portfolio {
  asOf: string;
  holdings: Holding[]; // value desc
  totals: {
    value: number;
    cost: number;
    dayGain: number;
    pnl: number;
    pnlPct: number;
  };
}

/** One CSV line → fields, handling quoted fields, escaped quotes, and commas. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

const num = (s: string | undefined): number => {
  const n = parseFloat((s ?? "").replace(/[,$]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Parse a CMC ProfitLoss CSV into a Portfolio. Returns null if unrecognisable. */
export function parseCmcCsv(text: string): Portfolio | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const at = (name: string) => header.indexOf(name.toLowerCase());
  const col = {
    code: at("Code"),
    last: at("Last"),
    units: at("Units Held"),
    cost: at("Cost AUD"),
    value: at("Market Value AUD"),
    day: at("Day Gain AUD"),
    pnl: at("P&L AUD"),
    pnlPct: at("P&L %"),
  };
  if (col.code < 0 || col.units < 0 || col.value < 0 || col.cost < 0) {
    return null;
  }

  const holdings: Holding[] = [];
  let totals: Portfolio["totals"] | null = null;

  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const code = (f[col.code] ?? "").trim();
    const isTotals =
      (f[0] ?? "").trim().toUpperCase() === "TOTALS" ||
      code.toUpperCase() === "TOTALS";
    if (isTotals) {
      totals = {
        value: num(f[col.value]),
        cost: num(f[col.cost]),
        dayGain: num(f[col.day]),
        pnl: num(f[col.pnl]),
        pnlPct: num(f[col.pnlPct]),
      };
      continue;
    }
    if (!code) continue;
    holdings.push({
      code,
      units: num(f[col.units]),
      last: num(f[col.last]),
      value: num(f[col.value]),
      cost: num(f[col.cost]),
      dayGain: num(f[col.day]),
      pnl: num(f[col.pnl]),
      pnlPct: num(f[col.pnlPct]),
    });
  }

  if (holdings.length === 0) return null;
  holdings.sort((a, b) => b.value - a.value);

  // Fall back to summing the holdings if the TOTALS row was absent.
  if (!totals) {
    const value = holdings.reduce((s, h) => s + h.value, 0);
    const cost = holdings.reduce((s, h) => s + h.cost, 0);
    const dayGain = holdings.reduce((s, h) => s + h.dayGain, 0);
    const pnl = value - cost;
    totals = {
      value,
      cost,
      dayGain,
      pnl,
      pnlPct: cost > 0 ? (pnl / cost) * 100 : 0,
    };
  }

  return { asOf: "", holdings, totals };
}
