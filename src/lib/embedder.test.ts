import { describe, expect, it } from "vitest";
import { EMBED_DIM, getEmbedder, lexicalEmbedder } from "./embedder";

/** L2 norm of a vector. */
function norm(v: Float32Array): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

describe("lexicalEmbedder", () => {
  const embed = lexicalEmbedder();

  it("emits a unit vector of the configured dimension", async () => {
    const v = await embed.embed("ferry to Manly this morning");
    expect(v).toHaveLength(EMBED_DIM);
    expect(norm(v)).toBeCloseTo(1, 5);
    expect(embed.dim).toBe(EMBED_DIM);
  });

  it("is deterministic — same text, byte-identical vector", async () => {
    const a = await embed.embed("caught the last train home");
    const b = await embed.embed("caught the last train home");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("gives unrelated text a different, lower-similarity vector", async () => {
    const a = await embed.embed("mahjong riichi tenpai wait");
    const b = await embed.embed("quarterly portfolio rebalance cash");
    expect(Array.from(a)).not.toEqual(Array.from(b));
    // shared-vocabulary pairs score higher than unrelated ones
    const near = await embed.embed("mahjong riichi furiten discard");
    let simNear = 0;
    let simFar = 0;
    for (let i = 0; i < EMBED_DIM; i++) {
      simNear += a[i] * near[i];
      simFar += a[i] * b[i];
    }
    expect(simNear).toBeGreaterThan(simFar);
  });

  it("embeds empty text to the zero vector without NaN", async () => {
    const v = await embed.embed("   \n  ");
    expect(norm(v)).toBe(0);
    expect(Array.from(v).some(Number.isNaN)).toBe(false);
  });

  it("honours a custom dimension", async () => {
    const small = lexicalEmbedder(16);
    expect(small.dim).toBe(16);
    expect(await small.embed("hello world")).toHaveLength(16);
  });
});

describe("getEmbedder", () => {
  it("resolves a working embedder and memoizes the same instance", async () => {
    const first = await getEmbedder();
    const second = await getEmbedder();
    expect(first).toBe(second); // one warm embedder per session
    expect(first.dim).toBe(EMBED_DIM);
    expect(await first.embed("anything")).toHaveLength(EMBED_DIM);
  });
});
