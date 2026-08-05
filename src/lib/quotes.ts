/**
 * quotes — the home page's one line of borrowed voice: a Reverend Insanity line,
 * chosen by the day and by where the rank stands.
 *
 * Seed pass — wording is best-effort fan translation; the owner curates like
 * /novels. (paraphrase) entries especially.
 *
 * Two rules make the bank behave like the rest of the sheet. Quotes are TIERED by
 * rank, so what the page says grows with the rank rather than spoiling a road not
 * walked yet; and the Legends of Ren Zu lines are SCRIPTURE (`rank: null`) — the
 * bible of that world, admissible at every rank, which is the owner's ruling and
 * not a fallback for a thin tier.
 *
 * Pure and clock-less like its neighbours: the day is an argument, never a
 * `Date.now()`, so the same Sydney date picks the same quote on every device.
 */

export interface RiQuote {
  /** The rank tier this quote belongs to; null = Legends of Ren Zu — scripture,
   *  admissible at EVERY rank (the owner's ruling: the bible of their world). */
  rank: number | null;
  text: string;
  /** provenance note — arc or source, for the owner's curation pass */
  arc?: string;
}

export const QUOTES: readonly RiQuote[] = [
  // --- rank 1 — the Qing Mao era, and the refrains that start there ------------
  {
    rank: 1,
    arc: "the refrain, from chapter one on",
    text: "In this world, only eternal life is worth pursuing.",
  },
  {
    rank: 1,
    arc: "the Qing Mao era",
    text: "I do not want to die, but I do not fear death. I am already on my right path — I will strive to have no regrets even if I die.",
  },
  {
    rank: 1,
    arc: "the Qing Mao era",
    text: "Human life is limited to its hundred years, as unreal as a dream that ends in an instant.",
  },
  {
    rank: 1,
    arc: "the Qing Mao era",
    text: "The only thing lacking in this world is a medicine for regret.",
  },
  {
    rank: 1,
    arc: "the early refrains",
    text: "Struggle is the main melody of this world.",
  },
  {
    rank: 1,
    arc: "the early refrains",
    text: "The weak have no right to choose.",
  },
  {
    rank: 1,
    arc: "the early refrains",
    text: "Opportunity always hides beside risk.",
  },
  {
    rank: 1,
    arc: "the early refrains",
    text: "The truth of this world: the strong prey on the weak.",
  },
  {
    rank: 1,
    arc: "the early refrains",
    text: "Relying on others is worse than relying on oneself.",
  },
  {
    rank: 1,
    arc: "the Qing Mao era (paraphrase)",
    text: "Take one step, and see three steps ahead.",
  },
  {
    rank: 1,
    arc: "the Qing Mao era (paraphrase)",
    text: "Face is worth nothing; living is everything.",
  },
  {
    rank: 1,
    arc: "the Qing Mao era (paraphrase)",
    text: "Patience is also a form of strength.",
  },
  {
    rank: 1,
    arc: "the Qing Mao era (paraphrase)",
    text: "Five hundred years of memories, and the lesson is simple: experience is the one thing no one can steal.",
  },
  {
    rank: 1,
    arc: "the Qing Mao era (paraphrase)",
    text: "A mortal's schemes can move immortals — if the mortal is willing to wait.",
  },

  // --- scripture — Legends of Ren Zu, admissible at every rank -----------------
  { rank: null, arc: "Legends of Ren Zu", text: "Humans strive upward." },
  {
    rank: null,
    arc: "Legends of Ren Zu",
    text: "Man is the spirit of all living beings.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu (paraphrase)",
    text: "Because humans have hope, they can keep walking through darkness.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu (paraphrase)",
    text: "Ren Zu traded his eyes, and learned to see with hope.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu (paraphrase)",
    text: "Wisdom is bitter, and the fruit of wisdom more bitter still. Eat it anyway.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu (paraphrase)",
    text: "Self is the source of all attainment.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu (paraphrase)",
    text: "Heaven gives no answers; it gives time.",
  },

  // --- the higher tiers — stocked one line at a time, at each breakthrough -----
  {
    rank: 2,
    arc: "(paraphrase)",
    text: "Only with strength can you speak of freedom.",
  },
  {
    rank: 3,
    text: "The footless bird can only fly; landing is its destruction.",
  },
];

const DAY_MS = 86_400_000;

/** A `YYYY-MM-DD` day as a whole number of days since the epoch, or null when the
 *  string is not a day. Built from the day's OWN numbers rather than `Date.now()`,
 *  so the index is a fact about the Sydney calendar date the caller passes in and
 *  every device holding that date lands on the same quote. */
function epochDay(dayISO: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayISO);
  if (m === null) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
}

/**
 * Today's quote: the current rank's tier plus all scripture, cycled by Sydney
 * day-index (days-since-epoch of the LOCAL Sydney date, modulo tier size).
 * Deterministic; null only if the tier is somehow empty.
 *
 * A day string this build can't read is not a reason to say nothing — the tier's
 * first line stands in, which is still the same line for everyone.
 */
export function quoteForDay(rank: number, dayISO: string): RiQuote | null {
  const tier = QUOTES.filter((q) => q.rank === rank || q.rank === null);
  if (tier.length === 0) return null;
  const day = epochDay(dayISO);
  if (day === null) return tier[0];
  return tier[((day % tier.length) + tier.length) % tier.length];
}
