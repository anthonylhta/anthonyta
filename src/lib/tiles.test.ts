import { describe, expect, it } from "vitest";
import { doraFromIndicator, isCorrectDiscard, tileLabel } from "./tiles";

describe("tileLabel", () => {
  it("labels number suits", () => {
    expect(tileLabel(1)).toBe("1m");
    expect(tileLabel(9)).toBe("9m");
    expect(tileLabel(14)).toBe("5p");
    expect(tileLabel(27)).toBe("9s");
  });
  it("labels honors as kanji", () => {
    expect(tileLabel(28)).toBe("東"); // East
    expect(tileLabel(31)).toBe("北"); // North
    expect(tileLabel(32)).toBe("白"); // Haku
    expect(tileLabel(34)).toBe("中"); // Chun
  });
});

describe("doraFromIndicator", () => {
  it("advances within a suit and wraps", () => {
    expect(doraFromIndicator(13)).toBe(14); // 4p -> 5p
    expect(doraFromIndicator(9)).toBe(1); // 9m -> 1m
    expect(doraFromIndicator(31)).toBe(28); // North -> East
    expect(doraFromIndicator(34)).toBe(32); // Chun -> Haku
  });
});

describe("isCorrectDiscard", () => {
  it("matches any of the optimal discards", () => {
    expect(isCorrectDiscard(9, [9])).toBe(true);
    expect(isCorrectDiscard(9, [3, 9])).toBe(true);
    expect(isCorrectDiscard(5, [9])).toBe(false);
  });
});
