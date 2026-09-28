/**
 * /novels — the single source of truth for the page: a small, hand-curated list
 * of novels worth showing, each with a one-line take. This is a *highlights reel,
 * not a log* — a novel earns a spot only when there's something to say about it,
 * which is what keeps the page from bloating. Adding one = append here.
 *
 * The webnovel connector (the live reading tracker) never adds rows; it only
 * enriches a "reading" entry with its live progress % (matched by title). So no
 * matter how many novels are marked "reading" in the tracker, the page shows only
 * what's curated below.
 *
 * `take` is a one-line lowercase blurb; the long-form thoughts live in
 * `reviews.tsx`, keyed by the `en` title.
 */

export type NovelStatus = "reading" | "finished" | "paused";

export interface Novel {
  en: string;
  /** original-language title, optional (not every novel is CJK) */
  zh?: string;
  author?: string;
  status: NovelStatus;
  take: string;
  link?: string;
  /** alternate English titles the tracker might use, for the live-% match */
  aliases?: string[];
}

export const novels: Novel[] = [
  {
    en: "Reverend Insanity",
    zh: "蛊真人",
    author: "Gu Zhen Ren",
    status: "reading",
    take: "the power system is the reason to read it: gu, parasitic insects that each grant one ability, refined and combined like a kit. the world moves forward too, new methods every era, so the ancients aren't automatically the strongest. long, dense, and the closest thing i have to a favourite. banned in china in 2019, left unfinished.",
    link: "https://www.novelupdates.com/series/reverend-insanity/",
  },
  {
    en: "The Eighteen Levels of Hell: Lying Is Forbidden",
    zh: "地狱十八层：这里禁止说谎",
    author: "Er Liang Bai Kai",
    status: "reading",
    aliases: ["Eighteen layers of hell: lying is forbidden"],
    take: "a survival-deduction story in a hell where lying kills you on the spot, so the whole game is getting other people to lie instead. the world's rules are just old lies nobody disproved.",
  },
];

/** Loose title match (lowercased, alphanumerics only) — the tracker's wording can drift. */
export function matchNovel(title: string): Novel | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = norm(title);
  return novels.find((n) =>
    [n.en, ...(n.aliases ?? [])].some((t) => norm(t) === key),
  );
}
