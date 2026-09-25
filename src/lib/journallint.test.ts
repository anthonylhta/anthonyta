import { describe, expect, it } from "vitest";
import { journalDateLint } from "./journallint";

const note = (fm: string, body = "the day\n") => `---\n${fm}\n---\n${body}`;

describe("journalDateLint", () => {
  it("passes a journal-date equal to the filename", () => {
    expect(
      journalDateLint(
        "2026-09-18",
        note("tags: [x]\njournal-date: 2026-09-18"),
      ),
    ).toBeNull();
  });

  it("flags a drifted date with the value found", () => {
    expect(
      journalDateLint("2026-09-18", note("journal-date: 2026-09-19")),
    ).toEqual({ kind: "drift", found: "2026-09-19" });
  });

  it("unquotes single- and double-quoted values", () => {
    expect(
      journalDateLint("2026-09-18", note('journal-date: "2026-09-18"')),
    ).toBeNull();
    expect(
      journalDateLint("2026-09-18", note("Journal-Date:  '2026-09-20' ")),
    ).toEqual({ kind: "drift", found: "2026-09-20" });
  });

  it("tolerates CRLF line endings", () => {
    const text = "---\r\njournal-date: 2026-09-23\r\n---\r\nbody\r\n";
    expect(journalDateLint("2026-09-23", text)).toBeNull();
    expect(journalDateLint("2026-09-22", text)).toEqual({
      kind: "drift",
      found: "2026-09-23",
    });
  });

  it("reports a missing key", () => {
    expect(journalDateLint("2026-09-23", note("tags: [x]"))).toEqual({
      kind: "missing",
    });
  });

  it("reports a note with no frontmatter as missing", () => {
    expect(journalDateLint("2026-09-23", "just words\n")).toEqual({
      kind: "missing",
    });
  });

  it("ignores a key after the frontmatter closes", () => {
    expect(
      journalDateLint(
        "2026-09-23",
        note("tags: [x]", "journal-date: 2026-09-23\n"),
      ),
    ).toEqual({ kind: "missing" });
  });

  it("ignores non-daily titles", () => {
    expect(journalDateLint("reading list", "no frontmatter")).toBeNull();
    expect(
      journalDateLint("2026-09", note("journal-date: 2026-09-01")),
    ).toBeNull();
  });

  it("ignores frontmatter that does not open on line 1", () => {
    expect(
      journalDateLint("2026-09-18", `\n${note("journal-date: 2026-09-18")}`),
    ).toEqual({ kind: "missing" });
  });
});
