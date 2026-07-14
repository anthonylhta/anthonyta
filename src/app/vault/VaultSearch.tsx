"use client";

import Link from "next/link";
import { Fragment, useMemo, useRef, useState } from "react";
import {
  deserializeIndex,
  highlightSegments,
  query,
  type TrigramIndex,
} from "@/lib/searchidx";
import { VAULT_SEARCH_INDEX_PATH, type VaultIndexNote } from "@/lib/vaultblob";

const input =
  "w-full border border-hairline bg-transparent px-3 py-1.5 text-sm text-fg placeholder:text-muted/60 focus:border-amber focus:outline-none";

/** How many notes a query returns. */
const K = 12;

type OpenItem = (envelope: Uint8Array) => Promise<{ bytes: Uint8Array }>;

// Every non-result outcome is a labelled state, never a blank or a crash — the same
// absent≠error discipline the rest of the vault reader keeps.
type State =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "noindex" } // a clean 404 — vault-sync hasn't built the index yet
  | { kind: "unreachable" } // network/store hiccup
  | { kind: "tamper" } // the index fetched but wouldn't decrypt/parse
  | { kind: "results"; q: string; results: Hit[] };

interface Hit {
  noteId: string;
  title: string;
  preview: string;
}

/**
 * Full-text search over the vault as a client island (unlock-gated by its parent). On
 * the first query it fetches the sealed `vault/search-index.bin` through the existing
 * owner-gated raw proxy, decrypts + parses it here in the browser, and matches entirely
 * client-side — the server sees neither the index nor the query, only the ciphertext it
 * already stores. The parsed trigram index is cached in a ref for the session, so repeat
 * searches skip the fetch. Matching is exact substring (character trigrams), bilingual
 * EN/日本語 by construction; a query shorter than 3 characters prefix-scans instead.
 */
export function VaultSearch({
  openItem,
  notes,
}: {
  openItem: OpenItem;
  notes: VaultIndexNote[];
}) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const indexRef = useRef<TrigramIndex | null>(null);
  const runRef = useRef(0); // drops a stale async resolve when queries overlap

  const byId = useMemo(() => {
    const map = new Map<string, VaultIndexNote>();
    for (const n of notes) if (!map.has(n.id)) map.set(n.id, n);
    return map;
  }, [notes]);

  // Fetch + decrypt + parse the sealed index once, then serve it from the ref. Returns
  // a state string on any miss so the caller degrades cleanly.
  async function loadIndex(): Promise<
    TrigramIndex | "noindex" | "unreachable" | "tamper"
  > {
    if (indexRef.current) return indexRef.current;
    let res: Response;
    try {
      res = await fetch(
        "/api/vault/raw?p=" + encodeURIComponent(VAULT_SEARCH_INDEX_PATH),
      );
    } catch {
      return "unreachable";
    }
    if (res.status === 404) return "noindex";
    if (res.status !== 200) return "unreachable";
    try {
      const { bytes } = await openItem(new Uint8Array(await res.arrayBuffer()));
      const parsed = deserializeIndex(bytes);
      indexRef.current = parsed;
      return parsed;
    } catch {
      return "tamper";
    }
  }

  async function run() {
    const text = q.trim();
    if (!text) {
      setState({ kind: "idle" });
      return;
    }
    const mine = ++runRef.current;
    setState({ kind: "searching" });

    const index = await loadIndex();
    if (mine !== runRef.current) return;
    if (typeof index === "string") {
      setState({ kind: index });
      return;
    }

    const results: Hit[] = query(index, text, K).map((r) => {
      const note = byId.get(r.id);
      return {
        noteId: r.id,
        title: note?.title ?? r.id,
        preview: note?.preview ?? "",
      };
    });
    setState({ kind: "results", q: text, results });
  }

  return (
    <div className="border-b border-hairline px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted">
          search
        </span>
        {state.kind === "searching" && (
          <span className="text-[10px] text-muted">searching…</span>
        )}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && run()}
        placeholder="search notes…"
        className={input}
      />

      <Results state={state} />
    </div>
  );
}

const MESSAGE: Record<string, { text: string; down?: boolean }> = {
  noindex: { text: "no search index yet — run npm run vault-sync" },
  unreachable: { text: "search unreachable — reload to retry", down: true },
  tamper: {
    text: "cannot decrypt the search index — lock and unlock",
    down: true,
  },
};

function Results({ state }: { state: State }) {
  if (state.kind === "idle" || state.kind === "searching") return null;

  if (state.kind !== "results") {
    const m = MESSAGE[state.kind];
    return (
      <p className={`mt-3 text-xs ${m.down ? "text-down" : "text-muted"}`}>
        {m.text}
      </p>
    );
  }

  if (state.results.length === 0)
    return <p className="mt-3 text-xs text-muted">no matches</p>;

  return (
    <ul className="mt-3 divide-y divide-hairline/40">
      {state.results.map((r, i) => (
        <li key={`${r.noteId}#${i}`} className="py-1.5">
          <Link
            href={`/vault/${r.noteId}`}
            prefetch
            className="text-[13px] text-fg hover:text-amber"
          >
            <Mark text={r.title} q={state.q} />
          </Link>
          {r.preview && (
            <p className="mt-0.5 truncate text-xs text-muted/70">
              <Mark text={r.preview} q={state.q} />
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Render `text` with every case-insensitive occurrence of the query in amber. */
function Mark({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlightSegments(text, q).map((seg, i) => (
        <Fragment key={i}>
          {seg.hit ? <span className="text-amber">{seg.text}</span> : seg.text}
        </Fragment>
      ))}
    </>
  );
}
