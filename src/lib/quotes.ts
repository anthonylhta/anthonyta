/**
 * quotes — the home page's one line of borrowed voice: a Reverend Insanity line,
 * chosen by the day and by where the rank stands.
 *
 * CURATION DOCTRINE (owner-ruled, 2026-08-06). Every entry is one of two kinds:
 * verbatim EXCERPTS of the fan translation as carried on the wiki's quote pages
 * (long passages may be split into line-sized parts and trimmed at the edges —
 * the wording itself is never rewritten), or `unverified` lines: refrains the
 * novel is known to lean on whose exact translated wording hasn't been checked
 * yet — kept for now, to be confirmed or cut by the owner. Invented in-the-
 * spirit-of lines were purged the same day the rule was made.
 *
 * TIERS are banded by chapter, coarsely — r1: ch 1–130 · r2: 131–230 ·
 * r3: 231–460 · r4: 461–560 · r5: 561–650 · r6: 651–1560 · r7: 1561–1800 ·
 * r8: 1801+ — a rough map of where Fang Yuan's own rank stood; every entry
 * carries its chapter so the owner can re-tier a line in seconds. The ch. 1285
 * first-life flashbacks sit in tier 1 deliberately: they are the mortal era
 * remembered. Scripture (`rank: null`) is admissible at every rank — the bible
 * of that world (owner's ruling).
 *
 * Pure and clock-less like its neighbours: the day is an argument, never a
 * `Date.now()`, so the same Sydney date picks the same quote on every device.
 */

export interface RiQuote {
  /** The rank tier this quote belongs to; null = scripture, admissible at EVERY
   *  rank (the owner's ruling: the bible of their world). */
  rank: number | null;
  text: string;
  /** provenance — chapter or source, so the owner can re-tier or verify */
  arc?: string;
  /** wording not yet checked against the translation — confirm or cut */
  unverified?: true;
}

export const QUOTES: readonly RiQuote[] = [
  // --- rank 1 · ch 1–130, the Qing Mao era --------------------------------------
  {
    rank: 1,
    arc: "ch. 1",
    text: "If the Spring Autumn Cicada that I have just cultivated is effective, I shall still be a demon in my next life!",
  },
  {
    rank: 1,
    arc: "ch. 1",
    text: "To be a demon is to be merciless and cruel — turning into an enemy to the world, still having to face the consequences.",
  },
  {
    rank: 1,
    arc: "ch. 2",
    text: "While the cage restricted freedom, the sturdy bars of the cage also brought about a certain kind of safety.",
  },
  {
    rank: 1,
    arc: "ch. 2",
    text: "The strong ate the weak — survival of the fittest; these had always been the rules of this world.",
  },
  {
    rank: 1,
    arc: "ch. 2",
    text: "Revenge is not my intention, the Demonic path does not compromise.",
  },
  {
    rank: 1,
    arc: "ch. 3",
    text: "People are not worried about whether they receive less; people worry about whether whatever they received is undistributed well.",
  },
  {
    rank: 1,
    arc: "ch. 6",
    text: "If others feel disappointed, then let them be disappointed. What else can they do?",
  },
  {
    rank: 1,
    arc: "ch. 6",
    text: "The most important thing is to carry hope inside my heart!",
  },
  {
    rank: 1,
    arc: "ch. 6",
    text: "The interesting things that happen in a person's life, happens during the process when one chases after his own dreams.",
  },
  {
    rank: 1,
    arc: "ch. 6",
    text: "Walk on your own path, let others be disappointed and unhappy however they please!",
  },
  {
    rank: 1,
    arc: "ch. 9",
    text: "Men would throw away their lives in pursuit for wealth.",
  },
  {
    rank: 1,
    arc: "ch. 10",
    text: "Only a fool would think others were stupid.",
  },
  {
    rank: 1,
    arc: "ch. 10",
    text: "A storm may arise from a clear sky; something unexpected may happen anytime. In this world who can do everything without obstacles in his way?",
  },
  {
    rank: 1,
    arc: "ch. 11",
    text: "When there is insufficient strength, only a fool would put himself in danger.",
  },
  {
    rank: 1,
    arc: "ch. 12",
    text: "With power, one can be at the top. This is the nature of this world.",
  },
  {
    rank: 1,
    arc: "ch. 13",
    text: "The truth is always hidden inside the fog of history.",
  },
  {
    rank: 1,
    arc: "ch. 13",
    text: "Don't even mention sense of clan honor, everyone has greed in their hearts.",
  },
  {
    rank: 1,
    arc: "ch. 13",
    text: "This is the helplessness of life, but it's also the charm of living.",
  },
  {
    rank: 1,
    arc: "ch. 13",
    text: "The end result of taking a risk was often unsatisfactory. But when the result was ideal, the profit would be impressive.",
  },
  {
    rank: 1,
    arc: "ch. 16",
    text: "Do not depend on anyone; you must rely on yourself on everything in this world.",
  },
  {
    rank: 1,
    arc: "ch. 19",
    text: "Life is fascinating, because no one will ever know what is waiting for him or her at the next moment.",
  },
  {
    rank: 1,
    arc: "ch. 20",
    text: "A fallen tiger still leaves behind threat; a festered ship still has three pounds of nails.",
  },
  { rank: 1, arc: "ch. 20", text: "Time waits for no one!" },
  {
    rank: 1,
    arc: "ch. 23",
    text: "An inch of gold cannot buy an inch of time. No matter how much money you have, can you buy time? You can't!",
  },
  {
    rank: 1,
    arc: "ch. 24",
    text: "Primeval stones are meant to be used; if you want to become a miser and accumulate primeval stones, then what did you become a Gu Master for?",
  },
  {
    rank: 1,
    arc: "ch. 24",
    text: "As for those with lofty aspirations, they usually showed a tolerant and generous attitude, and had the strength to give up and let go of things.",
  },
  {
    rank: 1,
    arc: "ch. 26",
    text: "Power is like the carrot dangling in front of a donkey.",
  },
  {
    rank: 1,
    arc: "ch. 26",
    text: "Any organization is just a representation, while the real basis is just one word – resources.",
  },
  {
    rank: 1,
    arc: "ch. 1285 — the first life, remembered",
    text: "This world is too big, but we are all minor characters… I will work hard! I will definitely do my best!",
  },
  {
    rank: 1,
    arc: "ch. 1285 — the first life, remembered",
    text: "I had once grieved, gradually, I became able to withstand everything. Only perseverance remains in my heart.",
  },

  // --- unverified refrains — confirm against the translation, or cut -----------
  {
    rank: 1,
    arc: "recurring refrain",
    unverified: true,
    text: "Struggle is the main melody of this world.",
  },
  {
    rank: 1,
    arc: "recurring refrain",
    unverified: true,
    text: "The weak have no right to choose.",
  },

  // --- scripture · Legends of Ren Zu — admissible at every rank -----------------
  {
    rank: null,
    arc: "Legends of Ren Zu",
    unverified: true,
    text: "Humans strive upward.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu",
    unverified: true,
    text: "Man is the spirit of all living beings.",
  },

  // --- rank 2 · ch 131–230 ------------------------------------------------------
  {
    rank: 2,
    arc: "ch. 127",
    text: "Not wanting to be trampled on, there are two ways. One is to become strong, strong until no one dares to step on you.",
  },
  {
    rank: 2,
    arc: "ch. 127",
    text: "I would rather let the world down, than be let down by the world!",
  },
  {
    rank: 2,
    arc: "ch. 127",
    text: "What truly stalls a person's success is not talent, but mindset.",
  },
  {
    rank: 2,
    arc: "ch. 131",
    text: "Humans are like isolated islands, floating in the sea of fate.",
  },
  {
    rank: 2,
    arc: "ch. 169",
    text: "Humans only live for a hundred years, it is as unreal as a dream that ends in an instant.",
  },
  {
    rank: 2,
    arc: "ch. 169",
    text: "Although I do not want to die, I do not fear death. I am already on my right path, I have no regrets even if I die.",
  },
  {
    rank: 2,
    arc: "ch. 227",
    text: "Because it has no legs, only wings, thus it has no choice but to fly. When it lands, that signifies its destruction.",
  },

  // --- rank 3 · ch 231–460 ------------------------------------------------------
  {
    rank: 3,
    arc: "ch. 291",
    text: "Bath in difficulties and sharpen the demonic soul; defy heaven, defy fate, defy the universe!",
  },
  {
    rank: 3,
    arc: "ch. 399",
    text: "In this world, everyone is a main character, but everyone is also a side character.",
  },
  {
    rank: 3,
    arc: "ch. 405",
    text: "Life was a gamble, if one did not gamble when they had the chance, when would they succeed?",
  },

  // --- rank 4 · ch 461–560 ------------------------------------------------------
  {
    rank: 4,
    arc: "ch. 464",
    text: "There is only immortality, only eternal life should be the goal one should pursue!",
  },
  {
    rank: 4,
    arc: "ch. 467",
    text: "Although an Immortal Gu is good, my goal is eternal life, this so-called Immortal Gu is merely a tool in my cultivation journey.",
  },
  {
    rank: 4,
    arc: "ch. 542",
    text: "Man, no matter which world they live in, all lives to conquer; conquer the enemy, conquer themselves…",
  },

  // --- rank 5 · ch 561–650 ------------------------------------------------------
  {
    rank: 5,
    arc: "ch. 567",
    text: "Whether eternal life existed or not, there was no evidence to prove it. But even if it did not exist, so what? Fang Yuan enjoyed the process.",
  },
  {
    rank: 5,
    arc: "ch. 647",
    text: "There was no absolutely desperate situation in this world, there were only people who despair.",
  },
  {
    rank: 5,
    arc: "ch. 647",
    text: "To discover oneself, to recognize oneself, and to rely on oneself!",
  },

  // --- rank 6 · ch 651–1560 -----------------------------------------------------
  {
    rank: 6,
    arc: "ch. 1544",
    text: "Love and friendship, killing and slaughtering, don't you all find this very boring?",
  },

  // --- rank 7 · ch 1561–1800 ----------------------------------------------------
  {
    rank: 7,
    arc: "ch. 1671",
    text: "Ask yourself, listen to the voice in the depths of your heart. What do you want to do, what kind of person you want to become, where do you want to go?",
  },
  {
    rank: 7,
    arc: "ch. 1671",
    text: "If you mistreat yourself frequently, then you will end up with regrets, you will constantly wear a mask to act as another person, you will no longer be yourself.",
  },
  {
    rank: 7,
    arc: "ch. 1673",
    text: "The vast power of time had changed him, but it also seemed like nothing had changed. He had always been Gu Yue Fang Yuan.",
  },
  {
    rank: 7,
    arc: "ch. 1786",
    text: "If I lack even this bit of ambition, what's the point of being human? Failure is fine, just try again several times.",
  },

  // --- rank 8 · ch 1801+ --------------------------------------------------------
  {
    rank: 8,
    arc: "ch. 1951",
    text: "If an immortal blocks me, I will slay the immortal, if a demon comes, I will slaughter the demon in my way!",
  },
  {
    rank: 8,
    arc: "ch. 2212 — becoming a venerable",
    text: "In my youth I knew the hardships of the world, yet I still aspired to soar above the clouds.",
  },
  {
    rank: 8,
    arc: "ch. 2212 — becoming a venerable",
    text: "A heart of steel forged from countless setbacks, a lifetime of effort to forge one sword.",
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
