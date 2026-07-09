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

const DB_NAME = "inbox-vault";
const STORE = "keys";
const ROW = "mk";

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

/** Forget the cached key — the storage half of the lock button. */
export async function clearCachedKey(): Promise<void> {
  await withStore("readwrite", (s) => s.delete(ROW));
}
