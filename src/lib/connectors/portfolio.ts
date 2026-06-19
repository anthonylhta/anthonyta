import { driveToken } from "@/lib/google";
import { parseCmcCsv, type Portfolio } from "@/lib/portfolio";

const DRIVE = "https://www.googleapis.com/drive/v3/files";

/**
 * portfolio connector (ADR 0012) — reads the NEWEST CMC CSV from the shared Drive
 * folder (same one the briefing uses) via the read-only service account, and
 * parses it. Private: only ever rendered behind auth; the public site never sees
 * it. Guarded → null on missing config / error, so the command center falls back
 * to the demo numbers. Anthony drops a fresh export in the folder each week.
 */
export async function getPortfolio(): Promise<Portfolio | null> {
  const token = await driveToken();
  const folderId = process.env.BRIEFING_FOLDER_ID;
  if (!token || !folderId) return null;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const q = encodeURIComponent(
      `'${folderId}' in parents and mimeType='text/csv' and trashed=false`,
    );
    const listRes = await fetch(
      `${DRIVE}?q=${q}&orderBy=modifiedTime desc&pageSize=1&fields=files(id,modifiedTime)`,
      { headers },
    );
    if (!listRes.ok) {
      console.error("[connector:portfolio] list failed", listRes.status);
      return null;
    }
    const list = (await listRes.json()) as {
      files?: { id: string; modifiedTime: string }[];
    };
    const file = list.files?.[0];
    if (!file) return null;

    const dl = await fetch(`${DRIVE}/${file.id}?alt=media`, { headers });
    if (!dl.ok) {
      console.error("[connector:portfolio] download failed", dl.status);
      return null;
    }
    const p = parseCmcCsv(await dl.text());
    if (!p) return null;

    p.asOf = new Date(file.modifiedTime).toLocaleString("en-AU", {
      timeZone: "Australia/Sydney",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return p;
  } catch (err) {
    console.error("[connector:portfolio] failed", err);
    return null;
  }
}
