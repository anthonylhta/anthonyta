// Sample briefing — a real example of Anthony's daily markets briefing (the one
// his Claude app generates), used to mock the UI before the live Google Drive
// ingestion is wired. The real connector will produce this same shape from the
// structured header + markdown body the app writes to Drive.

export type TapeItem = { label: string; value: string; move?: number };

export interface Briefing {
  date: string; // ISO
  weekday: string;
  generated: string;
  /** one-line "what's driving today" for the homepage */
  driver: string;
  /** 1-2 sentence intro for the /briefing page */
  summary: string;
  /** key levels, most important first (homepage shows the first 8) */
  tape: TapeItem[];
  bottomLine: string[];
  /** forward catalysts — the one-line "what to watch" strip */
  watch: { date: string; label: string }[];
  sections: { title: string; points: string[] }[];
  /** PRIVATE — portfolio relevance, gated behind your login (not in the live Doc) */
  portfolio?: string;
  /** optional citations */
  sources?: { label: string; url: string }[];
}

export const sampleBriefing: Briefing = {
  date: "2026-06-19",
  weekday: "Fri",
  generated: "06:30 AEST",
  driver: "hawkish Fed + signed US–Iran peace deal",
  summary:
    "Two stories dominate: a hawkish Fed under new chair Kevin Warsh (rates held, but the dot plot lifted and hikes are on the table) and the signed US–Iran peace framework, which has collapsed the oil war-risk premium. Net: US tech ripping, commodities and crypto soft, AUD firm.",
  tape: [
    { label: "ASX 200", value: "8,911", move: -0.62 },
    { label: "S&P 500", value: "ATH", move: 1.15 },
    { label: "Nasdaq 100", value: "—", move: 2.3 },
    { label: "Nikkei", value: "71,158", move: 1.8 },
    { label: "AUD/USD", value: "0.702", move: 0.3 },
    { label: "BTC", value: "64.0k", move: -1.8 },
    { label: "Brent", value: "$78", move: -4.0 },
    { label: "Gold", value: "$4,300", move: -0.5 },
    { label: "Hang Seng", value: "23,786", move: -2.16 },
    { label: "USD/JPY", value: "160", move: 0.2 },
    { label: "Iron ore", value: "$101", move: 0.4 },
    { label: "US 10Y", value: "4.46%" },
    { label: "VIX", value: "18.4", move: 12.4 },
  ],
  bottomLine: [
    "Hawkish Fed is the new regime signal — Warsh's first meeting removed the easing bias; median dot 3.8%, a hike possible by October.",
    "US tech shrugged it off: Nasdaq 100 +2.3% on a semiconductor surge, Nvidia ~$4.95tn. But it's narrow — VIX +12% even on an up day.",
    "The Iran peace deal crushed the oil risk premium (Brent ~$78, WTI ~$76.5). Disinflationary and risk-positive — but it's interim, with reversal risk.",
    "Australia lagged: ASX −0.62%, miners hit (BHP's $2.3bn Jansen writedown, RIO −2%), but iron ore steady ~$101 cushions the downside.",
    "A firm AUD (~0.702) dilutes unhedged offshore gains but lowers the cost of adding international exposure.",
  ],
  watch: [
    { date: "23 Jun", label: "global flash PMIs" },
    { date: "30 Jun", label: "ABS May jobs" },
    { date: "Aug", label: "RBA decision" },
  ],
  sections: [
    {
      title: "equities",
      points: [
        "Nasdaq 100 +2.3% on a semiconductor surge; Nvidia the standout at ~$4.95tn. Rally is narrow — concentration is the key risk.",
        "ASX miners hit: BHP −0.84% (A$2.3bn Jansen potash writedown), RIO −2.04%, leading a broad resources selloff.",
        "EM mixed: Hang Seng −2.16% the weak spot; India roughly flat on the Iran-relief vs Fed-hawkish offset.",
      ],
    },
    {
      title: "commodities",
      points: [
        "Brent ~$78 / WTI ~$76.5 — falling sharply as the US–Iran framework removes the war premium and reopens Hormuz.",
        "Gold ~$4,300 capped by the hawkish Fed and fading safe-haven demand.",
        "Iron ore ~$101 steady on China-stimulus hopes — the key support under the ASX miners.",
      ],
    },
    {
      title: "central banks",
      points: [
        "RBA held at 4.35% — 'a pause, not a pivot,' no cut discussed; inflation 4.2%.",
        "Fed held 3.50–3.75% but hawkish: median dot lifted to 3.8%, easing bias removed, hike possible by October.",
        "BoJ remains the dovish outlier; yen ~160. ECB quiet, European equities at records.",
      ],
    },
  ],
  portfolio:
    "Mildly favourable for an accumulating long-term investor. NDQ had a strong night (semis) but AUD strength trims it in AUD terms; BGBL/VGS ride the US/Europe record run (again currency-diluted); VGE mixed (weak Hang Seng vs supportive China stimulus); IOZ faces a soft resources open but iron-ore support limits the damage; VAF a mild capital headwind from firmer yields, offset by steady income; HISA stays attractive with the RBA at 4.35%. Net: keep dollar-cost-averaging — the firmer AUD makes today a slightly cheaper day to add international exposure.",
  sources: [
    {
      label: "Trading Economics — Australia",
      url: "https://tradingeconomics.com/australia/stock-market",
    },
    {
      label: "Saxo — Market Quick Take",
      url: "https://www.home.saxo/content/articles/macro/market-quick-take---18-june-2026-18062026",
    },
    {
      label: "Fox Business — FOMC",
      url: "https://www.foxbusiness.com/economy/federal-reserve-interest-rate-decision-june-17-2026",
    },
    {
      label: "CNBC — US/Iran deal",
      url: "https://www.cnbc.com/2026/06/14/us-iran-war-peace-deal.html",
    },
  ],
};
