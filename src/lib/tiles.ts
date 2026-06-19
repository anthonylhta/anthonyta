// Minimal riichi tile encoding, mirrored from the riichi project's `tiles.ts`
// (the source of truth). Man 1-9 | Pin 10-18 | Sou 19-27 | Winds E/S/W/N 28-31 |
// Dragons Haku/Hatsu/Chun 32-34. The hub re-renders hands in its own style, so it
// only needs the display + grading helpers, not the game engine.

export type TileCode = number;

const WIND_LABELS = ["", "東", "南", "西", "北"];
const DRAGON_LABELS = ["", "白", "發", "中"];

/** A tile code as a compact label: "3p" for number tiles, kanji for honors. */
export function tileLabel(code: TileCode): string {
  if (code <= 9) return `${code}m`;
  if (code <= 18) return `${code - 9}p`;
  if (code <= 27) return `${code - 18}s`;
  if (code <= 31) return WIND_LABELS[code - 27];
  return DRAGON_LABELS[code - 31];
}

export function suitOf(code: TileCode): "man" | "pin" | "sou" | "honor" {
  if (code <= 9) return "man";
  if (code <= 18) return "pin";
  if (code <= 27) return "sou";
  return "honor";
}

/** The dora is the tile after the indicator, wrapping within its suit. */
export function doraFromIndicator(ind: TileCode): TileCode {
  if (ind <= 9) return ind === 9 ? 1 : ind + 1;
  if (ind <= 18) return ind === 18 ? 10 : ind + 1;
  if (ind <= 27) return ind === 27 ? 19 : ind + 1;
  if (ind <= 31) return ind === 31 ? 28 : ind + 1;
  return ind === 34 ? 32 : ind + 1;
}

/** A discard is correct if it's one of the efficiency-optimal tiles. */
export function isCorrectDiscard(guess: TileCode, best: TileCode[]): boolean {
  return best.includes(guess);
}
