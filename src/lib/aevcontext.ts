/**
 * AEV2 context strings — the storage path each MK-sealed config blob binds to as
 * its AAD (ADR 0073). Threading these is what upgrades a store from AEV1 (integrity
 * of bytes) to AEV2 (integrity of bytes AT THIS ADDRESS): a compromised store can no
 * longer substitute one valid blob for another under the same key without the open
 * failing.
 *
 * ONE source of truth so a seal site and an open site can never drift — a mismatch
 * would make the blob unreadable on its next write. Each constant equals the R2 key
 * its `lib/*store` module already uses (`aevcontext.test.ts` pins them equal); this
 * module is deliberately dependency-free so it imports cleanly into client
 * components and the crypto worker without pulling in any server/store code.
 *
 * Backward-compatible by construction: `open` ignores the context for an existing
 * AEV1 envelope (dispatches on the magic), so threading a context breaks nothing at
 * rest — only the store's NEXT write becomes AEV2, and every reader here passes the
 * same context so it reads back. Migration is lazy, no flag day.
 *
 * Only the fixed single-blob config stores live here. The larger call sites named in
 * ADR 0073 — inbox (keyed per blob), vault (sealed by the vault-sync script), and the
 * dropbox key's sealed private half — thread their own paths as a follow-up.
 */

export const FIN_CONTEXT = "meta/fin";
export const TRANSIT_CONTEXT = "meta/transit";
export const TODO_CONTEXT = "meta/todo";
export const TOTP_CONTEXT = "meta/totp";
