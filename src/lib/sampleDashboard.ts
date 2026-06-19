// Placeholder data for the private command center. The portfolio numbers here are
// DEMO values (not real) — the real figures come from the CMC CSV parser at
// runtime, server-side, and are never committed. Replaced by real connectors.

import type { Portfolio } from "@/lib/portfolio";

export const samplePortfolio: Portfolio = {
  asOf: "demo",
  holdings: [
    {
      code: "NDQ",
      units: 40,
      last: 62.0,
      value: 2480.0,
      cost: 2300.0,
      dayGain: 22.0,
      pnl: 180.0,
      pnlPct: 7.8,
    },
    {
      code: "IOZ",
      units: 50,
      last: 35.0,
      value: 1750.0,
      cost: 1700.0,
      dayGain: -12.0,
      pnl: 50.0,
      pnlPct: 2.9,
    },
  ],
  totals: {
    value: 4230.0,
    cost: 4000.0,
    dayGain: 10.0,
    pnl: 230.0,
    pnlPct: 5.75,
  },
};

export const sampleDashboard = {
  reading: {
    title: "Eighteen layers of hell: lying is forbidden",
    chapter: 645,
    total: 754,
    streakDays: 23,
  },
  riichi: { currentStreak: 12, bestStreak: 41, todaySolved: false },
  today: [
    "wire the portfolio module",
    "review today's briefing",
    "DCA into VGS next week",
  ],
};
