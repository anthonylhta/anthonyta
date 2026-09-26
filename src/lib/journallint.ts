/**
 * The journal-date lint vault-sync runs over every note. A daily note is named
 * `YYYY-MM-DD.md` and its frontmatter carries a `journal-date:` field; the
 * FILENAME is the truth (the seals and the check-in count by it), so a field that
 * disagrees — or is missing — is worth a warning, never a failure. Pure, so it
 * tests without a vault.
 */

export type JournalDateFinding =
  | { kind: "drift"; found: string }
  | { kind: "missing" };

const DAILY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Check one note. Non-daily titles → null. Only a frontmatter block opening on
 * line 1 counts; a `journal-date:` equal to the title → null, a different value →
 * `drift` (the value trimmed + unquoted), no block or no key → `missing`.
 */
export function journalDateLint(
  title: string,
  text: string,
): JournalDateFinding | null {
  if (!DAILY.test(title)) return null;
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { kind: "missing" };
  for (const line of lines.slice(1)) {
    if (line.trim() === "---") break;
    const m = /^\s*journal-date\s*:\s*(.*?)\s*$/i.exec(line);
    if (!m) continue;
    const found = m[1].replace(/^(['"])(.*)\1$/, "$2").trim();
    return found === title ? null : { kind: "drift", found };
  }
  return { kind: "missing" };
}
