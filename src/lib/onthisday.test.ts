import { describe, expect, it } from "vitest";
import { anniversaryDay, onThisDay } from "./onthisday";
import type { VaultIndexNote } from "./vaultblob";

const note = (
  title: string,
  modified = `${title}T09:00:00Z`,
  path = `journals/${title}.md`,
): VaultIndexNote => ({ id: `id-${title}-${modified}`, title, path, modified });

describe("anniversaryDay", () => {
  it("steps back one calendar month, keeping the day", () => {
    expect(anniversaryDay("2026-08-24", "month")).toBe("2026-07-24");
    expect(anniversaryDay("2026-03-15", "month")).toBe("2026-02-15");
  });

  it("steps back one calendar year, keeping month and day", () => {
    expect(anniversaryDay("2026-08-24", "year")).toBe("2025-08-24");
  });

  it("crosses the year boundary in January", () => {
    expect(anniversaryDay("2026-01-09", "month")).toBe("2025-12-09");
    expect(anniversaryDay("2026-01-09", "year")).toBe("2025-01-09");
  });

  it("has no month anniversary when the day never happened", () => {
    // Sliding onto the 28th/30th would resurface a different day and call it an
    // anniversary, so a month that is short of the day has none.
    expect(anniversaryDay("2026-03-31", "month")).toBeNull(); // 2026-02-31
    expect(anniversaryDay("2026-05-31", "month")).toBeNull(); // 2026-04-31
    expect(anniversaryDay("2026-03-30", "month")).toBeNull(); // 2026-02-30
    expect(anniversaryDay("2026-08-31", "month")).toBe("2026-07-31");
  });

  it("has no anniversary landing on 29 February in a common year", () => {
    expect(anniversaryDay("2028-02-29", "year")).toBeNull(); // 2027 is common
    expect(anniversaryDay("2025-03-29", "month")).toBeNull(); // 2025-02-29
  });

  it("resolves 29 February when the target year is a leap year", () => {
    expect(anniversaryDay("2024-03-29", "month")).toBe("2024-02-29");
    expect(anniversaryDay("2025-02-29", "year")).toBeNull(); // today isn't real
  });

  it("is null for a today that isn't a real calendar day", () => {
    expect(anniversaryDay("2026-02-30", "month")).toBeNull();
    expect(anniversaryDay("2026-13-05", "month")).toBeNull();
    expect(anniversaryDay("2026-00-05", "year")).toBeNull();
    expect(anniversaryDay("24 aug 2026", "month")).toBeNull();
    expect(anniversaryDay("2026-8-4", "month")).toBeNull();
    expect(anniversaryDay("", "year")).toBeNull();
  });
});

describe("onThisDay", () => {
  it("finds the daily note in both windows", () => {
    const monthAgo = note("2026-07-24");
    const yearAgo = note("2025-08-24");
    const result = onThisDay(
      [note("2026-08-23"), monthAgo, note("2026-02-11"), yearAgo],
      "2026-08-24",
    );
    expect(result.monthAgo).toBe(monthAgo);
    expect(result.yearAgo).toBe(yearAgo);
  });

  it("returns only the window the journal has an entry for", () => {
    const monthAgo = note("2026-07-24");
    expect(onThisDay([monthAgo], "2026-08-24")).toEqual({ monthAgo });
    const yearAgo = note("2025-08-24");
    expect(onThisDay([yearAgo], "2026-08-24")).toEqual({ yearAgo });
  });

  it("returns nothing when no note is a daily", () => {
    // The same title rule `latestDailyDay` reads the journal edge by: a day, and
    // nothing else — not a dated prefix, not a date inside a sentence.
    expect(
      onThisDay(
        [
          note("Project Ideas", "2026-07-24T09:00:00Z", "Project Ideas.md"),
          note("2026-07-24 trip", "2026-07-24T09:00:00Z"),
          note("notes 2025-08-24", "2025-08-24T09:00:00Z"),
        ],
        "2026-08-24",
      ),
    ).toEqual({});
  });

  it("returns nothing for an empty index", () => {
    expect(onThisDay([], "2026-08-24")).toEqual({});
  });

  it("skips a window whose day never happened, keeping the other", () => {
    // The notes exist; the month anniversary (2026-02-31) does not.
    const result = onThisDay(
      [note("2026-02-28"), note("2026-03-31"), note("2025-03-31")],
      "2026-03-31",
    );
    expect(result.monthAgo).toBeUndefined();
    expect(result.yearAgo?.title).toBe("2025-03-31");
  });

  it("has no year match when the anniversary is 29 February in a common year", () => {
    expect(onThisDay([note("2023-02-29")], "2024-02-29")).toEqual({});
  });

  it("resolves a duplicated title to the first note in index order", () => {
    // The index arrives newest-first (`compareIndexNotes`), so first-wins is the
    // newest note — the resolution the reader's wikilinks already make.
    const newer = note("2026-07-24", "2026-08-01T05:00:00Z");
    const older = note(
      "2026-07-24",
      "2026-07-24T09:00:00Z",
      "old/2026-07-24.md",
    );
    expect(onThisDay([newer, older], "2026-08-24").monthAgo).toBe(newer);
  });

  it("reads today only from its argument", () => {
    // No clock inside the matcher: the answer is a function of the index and the
    // day it is handed, whenever the test runs.
    const notes = [note("2026-07-24"), note("2025-08-24")];
    expect(onThisDay(notes, "2026-08-24")).toEqual({
      monthAgo: notes[0],
      yearAgo: notes[1],
    });
    expect(onThisDay(notes, "1999-01-01")).toEqual({});
  });
});
