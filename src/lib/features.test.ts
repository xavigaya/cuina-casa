import { describe, expect, it } from "vitest";
import { computeShoppingNeeds, expandPlannedMeals, type RecipeNode } from "./shopping";
import { resolveLink, splitSteps, suggestLink } from "./recipes";
import { mergeResults, parseCommons, parseOpenverse } from "./image-search";

const sofregit: RecipeNode = {
  id: "sofregit",
  title: "Sofregit de tomàquet",
  servings: 4,
  yield_quantity: 500,
  yield_unit: "g",
  ingredients: [
    { name: "tomàquet", quantity: 1, unit: "kg" },
    { name: "ceba", quantity: 2, unit: "u" },
    { name: "oli d'oliva", quantity: 100, unit: "ml" },
  ],
};
const arros: RecipeNode = {
  id: "arros",
  title: "Arròs a la cassola",
  servings: 4,
  yield_quantity: null,
  yield_unit: null,
  ingredients: [
    { name: "arròs", quantity: 400, unit: "g" },
    { name: "sofregit de tomàquet", quantity: 200, unit: "g", sub_recipe_id: "sofregit" },
  ],
};
const graph = new Map([sofregit, arros].map((r) => [r.id, r]));

describe("preelaborats", () => {
  it("afegeix la part proporcional del preelaborat si no n'hi ha a casa", () => {
    const meals = expandPlannedMeals([{ recipeId: "arros", servings: null }], graph, [], 4);
    const needs = computeShoppingNeeds(meals, [], [], 4);
    const byName = Object.fromEntries(needs.map((n) => [n.name, n]));
    expect(byName["arròs"]).toMatchObject({ quantity: 400, unit: "g" });
    expect(byName["tomàquet"]).toMatchObject({ quantity: 400, unit: "g" }); // 1 kg × 200/500
    expect(byName["ceba"]).toMatchObject({ quantity: 1, unit: "u" }); // 0,8 → 1
    expect(byName["sofregit de tomàquet"]).toBeUndefined();
  });

  it("no compra res del preelaborat si ja n'hi ha prou a casa", () => {
    const pantry = [{ name: "Sofregit de tomàquet", quantity: 300, unit: "g" }];
    const meals = expandPlannedMeals([{ recipeId: "arros", servings: null }], graph, pantry, 4);
    const needs = computeShoppingNeeds(meals, pantry, [], 4);
    expect(needs.map((n) => n.name)).toEqual(["arròs"]);
  });

  it("si n'hi ha una part, només fa la que falta", () => {
    const pantry = [{ name: "sofregit", quantity: 150, unit: "g" }];
    const meals = expandPlannedMeals([{ recipeId: "arros", servings: null }], graph, [{ name: "sofregit de tomàquet", quantity: 150, unit: "g" }], 4);
    const needs = computeShoppingNeeds(meals, pantry, [], 4);
    expect(needs.find((n) => n.name === "tomàquet")).toMatchObject({ quantity: 100, unit: "g" }); // 50 g de 500
  });

  it("sense rendiment, fa el preelaborat per a les mateixes persones", () => {
    const g = new Map(graph);
    g.set("sofregit", { ...sofregit, yield_quantity: null });
    const meals = expandPlannedMeals([{ recipeId: "arros", servings: 8 }], g, [], 4);
    const needs = computeShoppingNeeds(meals, [], [], 4);
    expect(needs.find((n) => n.name === "tomàquet")).toMatchObject({ quantity: 2, unit: "kg" });
  });

  it("no entra en bucle si dues receptes es fan servir mútuament", () => {
    const a: RecipeNode = { ...arros, id: "a", ingredients: [{ name: "b", quantity: 1, unit: "u", sub_recipe_id: "b" }] };
    const b: RecipeNode = { ...arros, id: "b", title: "b", ingredients: [{ name: "a", quantity: 1, unit: "u", sub_recipe_id: "a" }] };
    const meals = expandPlannedMeals([{ recipeId: "a", servings: null }], new Map([["a", a], ["b", b]]), [], 4);
    expect(meals.length).toBeGreaterThan(0);
  });
});

describe("enllaços suggerits", () => {
  const recipes = [
    { id: "1", title: "Sofregit", is_component: true },
    { id: "2", title: "Brou de pollastre", is_component: true },
  ];
  it("enllaça per nom i respecta l'elecció de l'usuari", () => {
    expect(suggestLink("sofregit", recipes)).toBe("1");
    expect(suggestLink("tomàquet", recipes)).toBeNull();
    expect(resolveLink("sofregit", { sofregit: "" }, recipes)).toBeNull();
    expect(resolveLink("brou", { brou: "2" }, recipes)).toBe("2");
  });
});

describe("passos", () => {
  it("un pas per línia, sense numeració ni línies buides", () => {
    expect(splitSteps("1. Talla la ceba\n\n2) Sofregeix-la\nPas 3: Afegeix l'arròs\n- Remena")).toEqual([
      "Talla la ceba",
      "Sofregeix-la",
      "Afegeix l'arròs",
      "Remena",
    ]);
    expect(splitSteps(null)).toEqual([]);
  });
});

describe("cerca de fotos", () => {
  it("interpreta Openverse i Wikimedia", () => {
    const ov = parseOpenverse({
      results: [{ url: "https://x/1.jpg", thumbnail: "https://x/1t.jpg", title: "Paella", license: "by-sa", license_version: "2.0", foreign_landing_url: "https://f/1" }],
    });
    expect(ov[0]).toMatchObject({ url: "https://x/1.jpg", thumb: "https://x/1t.jpg", license: "CC BY-SA 2.0", source: "Openverse" });
    const wc = parseCommons({
      query: {
        pages: {
          "9": { index: 2, title: "File:Paella 2.jpg", imageinfo: [{ url: "https://w/2.jpg", thumburl: "https://w/2-600.jpg", mime: "image/jpeg" }] },
          "8": { index: 1, title: "File:Paella.svg", imageinfo: [{ url: "https://w/1.svg", mime: "image/svg+xml" }] },
        },
      },
    });
    expect(wc).toHaveLength(1);
    expect(wc[0]).toMatchObject({ url: "https://w/2-600.jpg", title: "Paella 2" });
    expect(mergeResults(ov, wc).map((r) => r.source)).toEqual(["Openverse", "Wikimedia"]);
    expect(parseOpenverse(null)).toEqual([]);
    expect(parseCommons({})).toEqual([]);
  });
});
