import { driveToken } from "@/lib/google";
import type { Briefing } from "@/lib/sampleBriefing";

/**
 * briefing connector — reads the daily markets briefing from Google Drive
 * (ADR 0009). A scheduled task writes a new dated doc into a shared folder each
 * morning; this reads the NEWEST doc, extracts the JSON block, and renders it.
 *
 * Auth: a read-only service account (Drive shared the folder with its email).
 * READ-ONLY. Fully guarded — missing creds (CI) or any failure returns `null`
 * so the page falls back to the sample. Only PUBLIC market content is in the
 * doc; portfolio relevance stays out until the hub has auth.
 */

const START = "<<<BRIEFING_JSON>>>";
const END = "<<<END_BRIEFING_JSON>>>";

async function fetchNewestDoc(): Promise<string | null> {
  const token = await driveToken();
  const folderId = process.env.BRIEFING_FOLDER_ID;
  if (!token || !folderId) return null;
  const headers = { Authorization: `Bearer ${token}` };

  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
  );
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=1&fields=files(id)`,
    { headers },
  );
  if (!listRes.ok) {
    console.error("[connector:briefing] list failed", listRes.status);
    return null;
  }
  const list = (await listRes.json()) as { files?: { id: string }[] };
  const id = list.files?.[0]?.id;
  if (!id) return null;

  const exportRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`,
    { headers },
  );
  if (!exportRes.ok) {
    console.error("[connector:briefing] export failed", exportRes.status);
    return null;
  }
  return exportRes.text();
}

/**
 * Extracts the JSON block. Uses the LAST `<<<BRIEFING_JSON>>>` marker so any
 * prose that merely mentions the marker can't be mistaken for the block, and
 * normalizes smart quotes Google Docs may insert.
 */
export function parseBriefing(text: string): Briefing | null {
  const s = text.lastIndexOf(START);
  const e = text.indexOf(END, s);
  if (s === -1 || e === -1) return null;
  const raw = text
    .slice(s + START.length, e)
    .trim()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  try {
    const d = JSON.parse(raw) as Briefing;
    if (!d.date || !Array.isArray(d.tape) || !Array.isArray(d.sections)) {
      return null;
    }
    return d;
  } catch (err) {
    console.error("[connector:briefing] JSON parse failed", err);
    return null;
  }
}

export async function getBriefing(): Promise<Briefing | null> {
  try {
    const text = await fetchNewestDoc();
    if (!text) return null;
    return parseBriefing(text);
  } catch (err) {
    console.error("[connector:briefing] failed", err);
    return null;
  }
}
