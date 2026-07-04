import { describe, expect, it } from "vitest";
import { preprocessNote } from "./vault";

const notes = [{ id: "noteA", title: "Daily 2026-06-20" }];
const images = [
  {
    id: "imgX",
    name: "20260620_101500.jpg",
    path: "Journals/Images/2026-06-20/20260620_101500.jpg",
  },
];
const refs = { notes, images };

describe("preprocessNote — image embeds", () => {
  it("resolves a full-path ![[...]] embed to the gated image route", () => {
    const out = preprocessNote(
      "![[Journals/Images/2026-06-20/20260620_101500.jpg]]",
      refs,
    );
    expect(out).toContain("![20260620_101500.jpg](/vault/img/imgX)");
  });

  it("resolves a bare-filename embed (Obsidian shortest-path)", () => {
    expect(preprocessNote("![[20260620_101500.jpg]]", refs)).toContain(
      "(/vault/img/imgX)",
    );
  });

  it("ignores an Obsidian size suffix", () => {
    expect(preprocessNote("![[20260620_101500.jpg|300]]", refs)).toContain(
      "(/vault/img/imgX)",
    );
  });

  it("matches case-insensitively", () => {
    expect(preprocessNote("![[20260620_101500.JPG]]", refs)).toContain(
      "(/vault/img/imgX)",
    );
  });

  it("leaves an unresolved embed as a placeholder", () => {
    const out = preprocessNote("![[missing.png]]", refs);
    expect(out).toContain("*[embed: missing.png]*");
    expect(out).not.toContain("/vault/img/");
  });

  it("rewrites a standard markdown image pointing at a vault file", () => {
    const out = preprocessNote(
      "![cap](Journals/Images/2026-06-20/20260620_101500.jpg)",
      refs,
    );
    expect(out).toContain("![cap](/vault/img/imgX)");
  });

  it("leaves an external markdown image untouched", () => {
    const src = "![x](https://example.com/a.png)";
    expect(preprocessNote(src, refs)).toContain(src);
  });

  it("survives a bare % in an image path instead of throwing", () => {
    const src = "![x](not%valid.png)";
    expect(preprocessNote(src, refs)).toContain(src);
  });

  it("resolves an image whose real filename contains a bare %", () => {
    const pctRefs = {
      notes: [],
      images: [{ id: "imgPct", name: "100%.png", path: "Charts/100%.png" }],
    };
    expect(preprocessNote("![done](100%.png)", pctRefs)).toContain(
      "![done](/vault/img/imgPct)",
    );
  });
});

describe("preprocessNote — wikilinks & frontmatter", () => {
  it("turns a known [[wikilink]] into an in-vault link", () => {
    expect(preprocessNote("see [[Daily 2026-06-20]]", refs)).toContain(
      "[Daily 2026-06-20](/vault/noteA)",
    );
  });

  it("renders an unknown wikilink as its bare label", () => {
    const out = preprocessNote("see [[Nope]]", refs);
    expect(out).toContain("see Nope");
    expect(out).not.toContain("](/vault/");
  });

  it("honors a wikilink alias", () => {
    expect(preprocessNote("[[Daily 2026-06-20|yesterday]]", refs)).toContain(
      "[yesterday](/vault/noteA)",
    );
  });

  it("resolves a [[Note#Heading]] link to the note", () => {
    expect(preprocessNote("[[Daily 2026-06-20#Morning]]", refs)).toContain(
      "[Daily 2026-06-20#Morning](/vault/noteA)",
    );
  });

  it("resolves a [[Note^block]] link to the note", () => {
    expect(preprocessNote("[[Daily 2026-06-20^ab12cd]]", refs)).toContain(
      "[Daily 2026-06-20^ab12cd](/vault/noteA)",
    );
  });

  it("resolves a suffixed link with an alias to the alias label", () => {
    expect(
      preprocessNote("[[Daily 2026-06-20#Morning|the morning]]", refs),
    ).toContain("[the morning](/vault/noteA)");
  });

  it("keeps a same-note [[#Heading]] link as its bare label", () => {
    const out = preprocessNote("see [[#Morning]]", refs);
    expect(out).toContain("see #Morning");
    expect(out).not.toContain("](/vault/");
  });

  it("strips YAML frontmatter", () => {
    expect(preprocessNote("---\ntags: x\n---\nbody", refs).trimStart()).toBe(
      "body",
    );
  });
});

describe("preprocessNote — duplicate names", () => {
  it("resolves a duplicated note title to the first (newest) entry", () => {
    // getVaultIndex sorts newest-first, so the first entry must win.
    const dupNotes = {
      notes: [
        { id: "newer", title: "Meeting" },
        { id: "older", title: "Meeting" },
      ],
      images: [],
    };
    expect(preprocessNote("[[Meeting]]", dupNotes)).toContain(
      "[Meeting](/vault/newer)",
    );
  });

  it("resolves a duplicated image basename to the first entry", () => {
    const dupImages = {
      notes: [],
      images: [
        { id: "firstImg", name: "shot.png", path: "A/shot.png" },
        { id: "secondImg", name: "shot.png", path: "B/shot.png" },
      ],
    };
    expect(preprocessNote("![[shot.png]]", dupImages)).toContain(
      "(/vault/img/firstImg)",
    );
  });

  it("still resolves both duplicate images by their full paths", () => {
    const dupImages = {
      notes: [],
      images: [
        { id: "firstImg", name: "shot.png", path: "A/shot.png" },
        { id: "secondImg", name: "shot.png", path: "B/shot.png" },
      ],
    };
    expect(preprocessNote("![[A/shot.png]]", dupImages)).toContain(
      "(/vault/img/firstImg)",
    );
    expect(preprocessNote("![[B/shot.png]]", dupImages)).toContain(
      "(/vault/img/secondImg)",
    );
  });
});
