import { describe, expect, it } from "vitest";
import { labelFieldText, parseNutritionLabel } from "./nutrition";

/** A supermarket product page paste — each figure printed twice around its
 *  "per serving" / "per 100" marker, energy in kJ only. */
const PRODUCT_PAGE = `Servings per pack,5.0
Serving size,140.0 G
5.0
140.0 G
Quantity Per Serving
Quantity Per 100g / 100mL
Energy
3160.0kJPer serving3160.0kJ
2259.0kJPer 100 grams or millilitres2259.0kJ
Protein
12.6gPer serving12.6g
9.0gPer 100 grams or millilitres9.0g
Fat, Total
26.6gPer serving26.6g
19.0gPer 100 grams or millilitres19.0g
– Saturated
11.2gPer serving11.2g
8.0gPer 100 grams or millilitres8.0g
Carbohydrate
115.0gPer serving115.0g
82.0gPer 100 grams or millilitres82.0g
– Sugars
15.4gPer serving15.4g
11.0gPer 100 grams or millilitres11.0g
Dietary Fibre
-Per servingNot Available
-Per 100 grams or millilitresNot Available
Sodium
2090.0mgPer serving2090.0mg
1490.0mg`;

/** The panel itself, transcribed row-wise with %DI and a Cal figure. */
const PANEL = `NUTRITION INFORMATION
Servings per package: 1
Serving size: 320 g
Avg Quantity per Serving %Daily Intake* Avg Quantity per 100 g
Energy 1780 kJ (425 Cal) 20% 555 kJ (133 Cal)
Protein 18.6 g 37% 5.8 g
Fat, total 19.8 g 28% 6.2 g
- saturated 5.8 g 24% 1.8 g
Carbohydrate 41.3 g 13% 12.9 g
- sugars 8.0 g 9% 2.5 g
Dietary fibre 3.2 g 11% 1.0 g
Sodium 1000 mg 43% 313 mg`;

/** Two panels on one box — the FIRST is the one read. */
const TWO_PANELS = `PARTY PIES
NUTRITION INFORMATION
Servings per package: 18
Serving size: approx. 46 g (1 Party Pie)
Energy 511 kJ (122 Cal) 6% 1110 kJ (265 Cal)
Protein 2.9 g 6% 6.3 g
Fat, total 7.3 g 10% 15.9 g
- saturated 3.7 g 15% 8.0 g
Carbohydrate 10.8 g 3% 23.4 g
- sugars 0.3 g 0.3% 0.6 g
Sodium 204 mg 9% 443 mg
PARTY SAUSAGE ROLLS
NUTRITION INFORMATION
Servings per package: 12
Serving size: approx. 38 g
Energy 437 kJ (105 Cal) 5% 1150 kJ (275 Cal)
Protein 2.5 g 5% 6.5 g`;

describe("parseNutritionLabel", () => {
  it("reads a product-page paste: per serve and per 100, kJ converted", () => {
    const r = parseNutritionLabel(PRODUCT_PAGE);
    expect(r).not.toBeNull();
    expect(r!.servingSize).toBe("140.0 g");
    expect(r!.servingsPerPack).toBe(5);
    expect(r!.perServe).toEqual({ kcal: 755, p: 12.6, c: 115, f: 26.6 });
    expect(r!.per100).toEqual({ kcal: 540, p: 9, c: 82, f: 19 });
  });

  it("reads a row-wise panel: %DI skipped, the printed Cal preferred", () => {
    const r = parseNutritionLabel(PANEL);
    expect(r!.servingSize).toBe("320 g");
    expect(r!.servingsPerPack).toBe(1);
    expect(r!.perServe).toEqual({ kcal: 425, p: 18.6, c: 41.3, f: 19.8 });
    expect(r!.per100).toEqual({ kcal: 133, p: 5.8, c: 12.9, f: 6.2 });
  });

  it("takes total fat, not saturated; carbohydrate, not sugars", () => {
    const r = parseNutritionLabel(PANEL)!;
    expect(r.perServe!.f).toBe(19.8);
    expect(r.perServe!.c).toBe(41.3);
  });

  it("reads the first panel when a box prints two", () => {
    const r = parseNutritionLabel(TWO_PANELS)!;
    expect(r.servingSize).toBe("approx. 46 g");
    expect(r.servingsPerPack).toBe(18);
    expect(r.perServe).toEqual({ kcal: 122, p: 2.9, c: 10.8, f: 7.3 });
    expect(r.per100).toEqual({ kcal: 265, p: 6.3, c: 23.4, f: 15.9 });
  });

  it("converts kJ when no Cal figure is printed", () => {
    const r = parseNutritionLabel(
      "Energy 1780 kJ 555 kJ\nProtein 18.6 g 5.8 g",
    )!;
    expect(r.perServe!.kcal).toBe(425);
    expect(r.per100!.kcal).toBe(133);
  });

  it("accepts 'saturated fat' spelled out without stealing the fat row", () => {
    const r = parseNutritionLabel(
      "Fat 10 g 4 g\nSaturated fat 3 g 1.2 g\nProtein 5 g 2 g",
    )!;
    expect(r.perServe!.f).toBe(10);
    expect(r.per100!.f).toBe(4);
  });

  it("does not read the '100' of 'per 100g' as a figure", () => {
    const r = parseNutritionLabel(
      "Protein\n12.6g per 100g\nFat, total\n3g per 100g",
    )!;
    expect(r.perServe).toEqual({ kcal: null, p: 12.6, c: null, f: 3 });
    expect(r.per100).toBeNull();
  });

  it("leaves a missing figure null rather than guessing", () => {
    const r = parseNutritionLabel("Energy 400 kJ 200 kJ\nProtein 5 g 2.5 g")!;
    expect(r.perServe).toEqual({ kcal: 96, p: 5, c: null, f: null });
    expect(r.per100).toEqual({ kcal: 48, p: 2.5, c: null, f: null });
  });

  it("is null for text that is not a label", () => {
    expect(parseNutritionLabel("hello there")).toBeNull();
    expect(parseNutritionLabel("")).toBeNull();
    // Labels but no figures — a header row on its own.
    expect(parseNutritionLabel("Energy Protein Fat Carbohydrate")).toBeNull();
  });

  it("accepts a decimal comma", () => {
    const r = parseNutritionLabel("Protein 12,6 g 9,0 g")!;
    expect(r.perServe!.p).toBe(12.6);
    expect(r.per100!.p).toBe(9);
  });
});

describe("labelFieldText", () => {
  it("rounds for the form — kcal whole, grams to one place, null empty", () => {
    expect(
      labelFieldText({ kcal: 425.4, p: 18.64, c: null, f: 19.75 }),
    ).toEqual({ kcal: "425", p: "18.6", c: "", f: "19.8" });
  });
});
