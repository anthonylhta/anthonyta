import { unstable_cache } from "next/cache";
import { APERTURE_GLANCE_PATH } from "@/lib/aperturestore";
import { BACKUP_STAMP_PATH } from "@/lib/chores";
import { r2Enabled, r2List, readKey } from "@/lib/r2";

/**
 * chores connector — the server-visible cadences of the needs-doing board
 * (roadmap 52, then 72): vault-sync's and the seal's freshness from R2 object
 * metadata, the backup's from its stamp. All fully guarded to null ("no
 * record") — the board nags, it never errors. The gym and CSV cadences are
 * deliberately NOT here: their evidence lives inside E2EE envelopes and is read
 * client-side.
 */

export interface ChoreReads {
  /** ISO upload time of the vault search index — vault-sync's last run. */
  vaultSyncedAt: string | null;
  /** ISO stamp the backup script writes on success. */
  backupAt: string | null;
  /** ISO upload time of the plaintext aperture glance — the last seal. */
  apertureSealedAt: string | null;
}

const NO_RECORDS: ChoreReads = {
  vaultSyncedAt: null,
  backupAt: null,
  apertureSealedAt: null,
};

const load = unstable_cache(
  async (): Promise<ChoreReads> => {
    let vaultSyncedAt: string | null = null;
    try {
      const page = await r2List("vault/search-index.bin");
      vaultSyncedAt = page.objects[0]?.lastModified || null;
    } catch {
      // list failed → no record, never an error on the homepage
    }

    let apertureSealedAt: string | null = null;
    try {
      const page = await r2List(APERTURE_GLANCE_PATH);
      apertureSealedAt = page.objects[0]?.lastModified || null;
    } catch {
      // same guard: a failed list is silence, not a missed check-in
    }

    let backupAt: string | null = null;
    const stamp = await readKey(BACKUP_STAMP_PATH);
    if (stamp.state === "ok") {
      const text = new TextDecoder().decode(stamp.value).trim();
      backupAt = text || null;
    }

    return { vaultSyncedAt, backupAt, apertureSealedAt };
  },
  ["chores"],
  { revalidate: 900, tags: ["chores"] },
);

/** The chores evidence; store off (CI, dev) → no records. */
export async function getChoreReads(): Promise<ChoreReads> {
  if (!r2Enabled()) return NO_RECORDS;
  try {
    return await load();
  } catch (err) {
    console.error("[connector:chores] read failed:", err);
    return NO_RECORDS;
  }
}
