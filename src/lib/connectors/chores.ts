import { unstable_cache } from "next/cache";
import { BACKUP_STAMP_PATH } from "@/lib/chores";
import { r2Enabled, r2List, readKey } from "@/lib/r2";

/**
 * chores connector — the server-visible halves of the chores row (roadmap
 * 52): vault-sync's freshness from R2 object metadata, the backup's from its
 * stamp. Both fully guarded to null ("no record") — the row nags, it never
 * errors. The CSV half is deliberately NOT here: its evidence lives inside
 * the E2EE fin envelope and is read client-side.
 */

export interface ChoreReads {
  /** ISO upload time of the vault search index — vault-sync's last run. */
  vaultSyncedAt: string | null;
  /** ISO stamp the backup script writes on success. */
  backupAt: string | null;
}

const load = unstable_cache(
  async (): Promise<ChoreReads> => {
    let vaultSyncedAt: string | null = null;
    try {
      const page = await r2List("vault/search-index.bin");
      vaultSyncedAt = page.objects[0]?.lastModified || null;
    } catch {
      // list failed → no record, never an error on the homepage
    }

    let backupAt: string | null = null;
    const stamp = await readKey(BACKUP_STAMP_PATH);
    if (stamp.state === "ok") {
      const text = new TextDecoder().decode(stamp.value).trim();
      backupAt = text || null;
    }

    return { vaultSyncedAt, backupAt };
  },
  ["chores"],
  { revalidate: 900, tags: ["chores"] },
);

/** The chores evidence; store off (CI, dev) → no records. */
export async function getChoreReads(): Promise<ChoreReads> {
  if (!r2Enabled()) return { vaultSyncedAt: null, backupAt: null };
  try {
    return await load();
  } catch (err) {
    console.error("[connector:chores] read failed:", err);
    return { vaultSyncedAt: null, backupAt: null };
  }
}
