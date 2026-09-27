"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { relatedDocs } from "@/lib/searchidx";
import { type VaultIndexNote } from "@/lib/vaultblob";
import { loadSearchIndex, noteMap, type OpenEnvelope } from "@/lib/vaultquery";

/** How many related notes the strip shows. */
const K = 5;

/**
 * The notes that share the most vocabulary with this one, under its body — scored
 * in the browser off the same sealed trigram index /vault's search decrypts, so the
 * server learns nothing new. Overlap is literal (shared rare trigrams, idf-weighted),
 * not semantic. Exception-only like on-this-day: no index, any failure, or nothing
 * clearing the shared-trigram floor renders nothing at all.
 */
export function RelatedNotes({
  id,
  notes,
  openItem,
}: {
  id: string;
  notes: VaultIndexNote[];
  openItem: OpenEnvelope;
}) {
  const [related, setRelated] = useState<VaultIndexNote[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const index = await loadSearchIndex(openItem);
      if (cancelled || typeof index === "string") return;
      const byId = noteMap(notes);
      setRelated(
        relatedDocs(index, id, K).flatMap((r) => byId.get(r.id) ?? []),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [id, notes, openItem]);

  if (related.length === 0) return null;

  return (
    <div className="border-t border-hairline px-4 py-4">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
        related
      </span>
      <ul className="mt-2 divide-y divide-hairline/40">
        {related.map((note) => (
          <li key={note.id} className="py-1">
            <Link
              href={`/vault/${note.id}`}
              prefetch
              className="break-words text-[13px] text-fg hover:text-amber"
            >
              {note.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
