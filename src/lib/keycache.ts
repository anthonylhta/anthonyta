/**
 * keycache — the unlock-once-per-device store (ADR 0053). A CryptoKey is a
 * structured-cloneable object, so the NON-extractable master key can sit in
 * IndexedDB across reloads without its raw bytes ever being readable, even by
 * this code. "Lock" is just deleting the row.
 *
 * Client-only (IDB doesn't exist server-side) and best-effort by design: the
 * cache is disposable — if the browser evicts it (Safari's 7-day ITP purge on
 * non-installed sites, storage pressure) the only cost is re-typing the
 * passphrase. Every failure path resolves rather than throws so callers can
 * treat "no cached key" and "IDB broken" identically.
 */

/** Idle window: a cached key untouched this long is dropped, so a stolen
 *  unlocked device stops reading the vault after a week. */
export const IDLE_LOCK_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether a last-activity stamp is old enough to force a re-unlock. A
 *  non-finite stamp counts as stale — a corrupted stamp fails toward locked,
 *  never unlocked-forever. A future stamp (clock skew/rollback) is NOT stale: a
 *  skewed clock shouldn't lock the owner out, and it self-heals on the next touch. */
export function isIdleStale(lastMs: number, nowMs: number): boolean {
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs > IDLE_LOCK_MS;
}

const DB_NAME = "inbox-vault";
const STORE = "keys";
const ROW = "mk";
const ACTIVITY_ROW = "activity";

function withStore(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const openReq = indexedDB.open(DB_NAME, 1);
      openReq.onupgradeneeded = () => {
        openReq.result.createObjectStore(STORE);
      };
      openReq.onerror = () => resolve(undefined);
      openReq.onsuccess = () => {
        const db = openReq.result;
        try {
          const tx = db.transaction(STORE, mode);
          const req = run(tx.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
          tx.oncomplete = () => db.close();
          tx.onabort = () => {
            db.close();
            resolve(undefined);
          };
        } catch {
          db.close();
          resolve(undefined);
        }
      };
    } catch {
      resolve(undefined);
    }
  });
}

/** The cached master key, or null when absent/evicted/unreadable. */
export async function getCachedKey(): Promise<CryptoKey | null> {
  const v = await withStore("readonly", (s) => s.get(ROW));
  return v instanceof CryptoKey ? v : null;
}

/** Cache the (non-extractable) master key for the next launch. Best-effort. */
export async function setCachedKey(key: CryptoKey): Promise<void> {
  await withStore("readwrite", (s) => s.put(key, ROW));
}

/** The last-activity stamp (ms), or null when absent/garbage/IDB-broken. */
export async function getActivityStamp(): Promise<number | null> {
  const v = await withStore("readonly", (s) => s.get(ACTIVITY_ROW));
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Stamp "the vault was used just now", rolling the idle window. Best-effort. */
export async function touchActivityStamp(now = Date.now()): Promise<void> {
  await withStore("readwrite", (s) => s.put(now, ACTIVITY_ROW));
}

/** Forget the cached key and its activity stamp — the storage half of the lock
 *  button; the stamp is meaningless without a key. */
export async function clearCachedKey(): Promise<void> {
  await withStore("readwrite", (s) => s.delete(ROW));
  await withStore("readwrite", (s) => s.delete(ACTIVITY_ROW));
}
