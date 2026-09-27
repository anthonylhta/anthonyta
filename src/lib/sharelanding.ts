/**
 * sharelanding — what the /files landing says after a share-sheet POST.
 *
 * sw.js stashes each shared file on its own and names every exit in the query
 * string (ADR 0206): `?share=failed&r=<code>` when nothing was stashed, and
 * `?shared=1&n=<stashed>&f=<failed>` when something was. These turn those codes
 * into one owner-facing line each. The raw code rides at the end of every line
 * so the next episode can be matched to its stage without guessing.
 */

const LEGACY_FAILURE = "share failed — file too large or store offline";

/** The failure banner for `?share=failed` — `r` is the stage, `n` the files
 *  seen, `q` the phone's storage as `usedMB/quotaMB` when a put failed. */
export function shareFailureLine(
  r: string | undefined,
  n?: string,
  q?: string,
): string {
  if (r === undefined) return LEGACY_FAILURE;
  let line: string;
  if (r === "form")
    line = "the share couldn't be read on the phone — try fewer photos at once";
  else if (r.startsWith("put:"))
    line = `the phone refused to hold the batch${q ? ` (${q} MB used)` : ""} — share fewer at once`;
  else if (r === "empty")
    line = "nothing arrived in the share — pick the photos again";
  else if (r === "open")
    line =
      "the app's share cache wouldn't open — reopen the app and share again";
  else if (r === "sw-miss")
    line =
      "the app wasn't ready to take the share — open it once, then share again";
  else line = LEGACY_FAILURE;
  return `${line} (${r}${n ? ` · ${n} files` : ""})`;
}

/** The landing note for `?shared=1`: `n` stashed, `f` that failed to stash,
 *  `drained` what this tab actually picked up, `why` the worker's code when a
 *  put failed. Null when everything arrived. */
export function shareLandingLine(
  n: number,
  f: number,
  drained: number,
  why?: string,
): string | null {
  const tail = why ? ` (${why})` : "";
  if (drained === 0)
    return `the shared photos didn't reach this tab — share again${tail}`;
  const parts: string[] = [];
  if (f > 0) parts.push(`stashed ${n} · ${f} failed to stash`);
  if (drained < n) parts.push(`drained ${drained} of ${n}`);
  // Leftovers from a share that died mid-stash under the old worker: they go
  // up with this batch, so say so rather than let the count surprise.
  if (drained > n)
    parts.push(
      `drained ${drained} · ${drained - n} left over from an earlier share`,
    );
  if (parts.length === 0) return null;
  const redo =
    drained < n
      ? " — share the rest again"
      : f > 0
        ? " — share those again"
        : "";
  return `${parts.join(" · ")}${redo}${tail}`;
}
