/**
 * vaultquery — the browser half of vault full-text search: pull a sealed leaf
 * through the owner-gated raw proxy, decrypt it here, and turn a query into note
 * hits that carry their titles. Lifted out of <VaultSearch> so the ⌘K palette can
 * run the identical path (roadmap 82d) rather than grow a second copy that drifts
 * from the reader's. No React and no storage, so the join at the bottom stays pure
 * and unit-testable; the crypto is either handed in (the vault hook's `openItem`)
 * or built from a cached master key.
 *
 * The server sees only the ciphertext it already stores — never a query, never a
 * title, exactly as on /vault.
 */

import { open } from "./crypto";
import { deserializeIndex, query, type TrigramIndex } from "./searchidx";
import {
  isVaultIndex,
  VAULT_INDEX_PATH,
  VAULT_SEARCH_INDEX_PATH,
  type VaultIndexNote,
} from "./vaultblob";

/** Decrypt one envelope — `useVault`'s `openItem`, or `openerFor(mk)` below. */
export type OpenEnvelope = (
  envelope: Uint8Array,
) => Promise<{ bytes: Uint8Array }>;

/**
 * Every non-result outcome as a labelled string, never a throw or a pretend-empty
 * index: a clean 404 (vault-sync hasn't written this leaf yet), a network/store
 * hiccup, and "fetched but wouldn't decrypt/parse" are three different truths and
 * the caller renders them differently.
 */
export type LoadFailure = "noindex" | "unreachable" | "tamper";

/** Fetch one sealed `vault/*` leaf. The body is deliberately left unread: the
 *  caller drains it inside its own try, so a truncated stream reads as tamper
 *  (what it is) rather than as an unreachable store. */
async function fetchLeaf(path: string): Promise<Response | LoadFailure> {
  let res: Response;
  try {
    res = await fetch("/api/vault/raw?p=" + encodeURIComponent(path));
  } catch {
    return "unreachable";
  }
  if (res.status === 404) return "noindex";
  if (res.status !== 200) return "unreachable";
  return res;
}

/** Fetch + decrypt + parse the sealed trigram index. */
export async function loadSearchIndex(
  openItem: OpenEnvelope,
): Promise<TrigramIndex | LoadFailure> {
  const res = await fetchLeaf(VAULT_SEARCH_INDEX_PATH);
  if (typeof res === "string") return res;
  try {
    const { bytes } = await openItem(new Uint8Array(await res.arrayBuffer()));
    return deserializeIndex(bytes);
  } catch {
    return "tamper";
  }
}

/** Fetch + decrypt + parse the sealed note index — the titles a hit is joined to. */
export async function loadNoteIndex(
  openItem: OpenEnvelope,
): Promise<VaultIndexNote[] | LoadFailure> {
  const res = await fetchLeaf(VAULT_INDEX_PATH);
  if (typeof res === "string") return res;
  try {
    const { bytes } = await openItem(new Uint8Array(await res.arrayBuffer()));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isVaultIndex(parsed)) throw new Error("bad shape");
    return parsed.notes;
  } catch {
    return "tamper";
  }
}

/** Notes by id, first-wins — the index is newest-first, so a duplicated id
 *  resolves to the newest note, matching the reader (ADR 0048). */
export function noteMap(notes: VaultIndexNote[]): Map<string, VaultIndexNote> {
  const map = new Map<string, VaultIndexNote>();
  for (const n of notes) if (!map.has(n.id)) map.set(n.id, n);
  return map;
}

export interface NoteHit {
  noteId: string;
  title: string;
  preview: string;
}

/** Rank notes for `text` and dress each hit with its title + preview. A hit the
 *  note index doesn't know (a stale search index, mid-sync) still resolves — to
 *  its id — so a search never silently drops a real match. */
export function titledHits(
  index: TrigramIndex,
  byId: Map<string, VaultIndexNote>,
  text: string,
  k: number,
): NoteHit[] {
  return query(index, text, k).map((r) => {
    const note = byId.get(r.id);
    return {
      noteId: r.id,
      title: note?.title ?? r.id,
      preview: note?.preview ?? "",
    };
  });
}

/** An opener over a bare master key, for callers outside the vault hook (the
 *  palette). Both vault indexes are sealed without a context, so this is the
 *  plain AEV1 open — no path to re-supply. */
export function openerFor(mk: CryptoKey): OpenEnvelope {
  return (envelope) => open(mk, envelope);
}

/** A loaded, queryable vault: text in, titled hits out, all in memory. */
export type NoteSearch = (text: string, k: number) => NoteHit[];

/**
 * One-shot load of both indexes under `mk`, for a caller that holds the master key
 * rather than the vault hook. Returns null when anything at all is missing — no
 * index, no notes, a hiccup, a bad decrypt — because the one caller (the ⌘K
 * palette) has exactly one degraded mode: behave as though the feature isn't there.
 */
export async function loadNoteSearch(
  mk: CryptoKey,
): Promise<NoteSearch | null> {
  const openItem = openerFor(mk);
  const [index, notes] = await Promise.all([
    loadSearchIndex(openItem),
    loadNoteIndex(openItem),
  ]);
  if (typeof index === "string" || typeof notes === "string") return null;
  const byId = noteMap(notes);
  return (text, k) => titledHits(index, byId, text, k);
}
