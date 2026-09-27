/**
 * readeraffinity — journal affinity for the /reader lanes: how many of each
 * headline's rare trigrams the owner's last two weeks of daily notes already
 * carry, scored in the browser off the sealed trigram index (`affinityOf`). Literal overlap, not
 * meaning — a headline naming a place, a person or a word the journal used lately
 * lifts; a synonym doesn't. Only ever reached through a dynamic import after the
 * device key cache answers (ADR 0022), so neither the index format nor the crypto
 * ride the reader's own chunk; the server sees only the ciphertext it already
 * serves /vault.
 */

import { isDailyTitle } from "./checkin";
import { sydneyDaysAgo, sydneyToday } from "./fin";
import type { FeedItem } from "./reader";
import { affinityOf } from "./searchidx";
import { loadNoteIndex, loadSearchIndex, openerFor } from "./vaultquery";

/** How far back the journal counts: two weeks of daily notes. */
export const AFFINITY_DAYS = 14;

/** Affinity per headline link, or null when anything at all is missing — no
 *  index, no notes, no recent daily note, a bad decrypt. */
export async function journalAffinity(
  mk: CryptoKey,
  items: FeedItem[],
): Promise<Map<string, number> | null> {
  const openItem = openerFor(mk);
  const [index, notes] = await Promise.all([
    loadSearchIndex(openItem),
    loadNoteIndex(openItem),
  ]);
  if (typeof index === "string" || typeof notes === "string") return null;
  const from = sydneyDaysAgo(AFFINITY_DAYS);
  const today = sydneyToday();
  const ids = notes
    .filter((n) => isDailyTitle(n.title) && n.title >= from && n.title <= today)
    .map((n) => n.id);
  if (ids.length === 0) return null;
  return new Map(items.map((i) => [i.link, affinityOf(index, ids, i.title)]));
}
