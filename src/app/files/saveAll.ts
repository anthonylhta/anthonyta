import type { EnvelopeMeta } from "@/lib/crypto";
import { saveName, type InboxFile } from "@/lib/files";

/**
 * The inbox's "save all images": decrypt every sealed row, keep the images, and
 * write them out in one go — the PC half of a phone share-sheet batch. A row's
 * name and type live INSIDE its envelope, so which rows are images is only known
 * after opening each one; everything else is dropped again without touching disk.
 *
 * Two doors, best first. Chromium's folder picker writes straight into a folder
 * chosen once (the browser remembers it under `id`), and every write is awaited,
 * so a row reported as saved IS on disk. Anywhere the picker is missing the rows
 * go out as ordinary downloads instead — fire-and-forget, the browser may ask
 * once about multiple files — and nothing is reported as confirmed.
 */

type DirPicker = (opts?: {
  id?: string;
  mode?: "read" | "readwrite";
}) => Promise<FileSystemDirectoryHandle>;

export interface SaveAllResult {
  /** Pathnames of the rows that went out. */
  saved: string[];
  failed: number;
  /** The chosen folder's name — null when the rows left as plain downloads. */
  folder: string | null;
}

async function exists(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** Resolves null when the owner backs out of the folder picker. */
export async function saveAllImages(
  files: InboxFile[],
  openItem: (
    envelope: Uint8Array,
  ) => Promise<{ meta: EnvelopeMeta; bytes: Uint8Array }>,
  isImage: (meta: EnvelopeMeta) => boolean,
  onProgress: (done: number, total: number) => void,
): Promise<SaveAllResult | null> {
  // The picker needs the click's user activation, so it opens before any await.
  const picker = (window as { showDirectoryPicker?: DirPicker })
    .showDirectoryPicker;
  let dir: FileSystemDirectoryHandle | null = null;
  if (picker) {
    try {
      dir = await picker({ id: "inbox-save", mode: "readwrite" });
    } catch {
      return null;
    }
  }

  const sealed = files.filter((f) => f.encrypted);
  const taken = new Set<string>();
  const saved: string[] = [];
  let failed = 0;
  let done = 0;
  for (const f of sealed) {
    onProgress(done++, sealed.length);
    try {
      const res = await fetch(
        `/api/files/raw?p=${encodeURIComponent(f.pathname)}`,
      );
      if (!res.ok) throw new Error("fetch failed");
      const { meta, bytes } = await openItem(
        new Uint8Array(await res.arrayBuffer()),
      );
      if (!isImage(meta)) continue;
      const blob = new Blob([bytes as BlobPart], {
        type: meta.t || "application/octet-stream",
      });
      let name = saveName(meta.n, taken);
      if (dir) {
        // Never write over what the folder already holds.
        while (await exists(dir, name)) name = saveName(meta.n, taken);
        const handle = await dir.getFileHandle(name, { create: true });
        const out = await handle.createWritable();
        await out.write(blob);
        await out.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        // Back-to-back programmatic downloads get dropped; a short gap doesn't.
        await new Promise((r) => setTimeout(r, 250));
      }
      saved.push(f.pathname);
    } catch {
      failed++;
    }
  }
  return { saved, failed, folder: dir ? dir.name : null };
}
