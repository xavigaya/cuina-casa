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

describe("importació tolerant amb JSON-LD mal format", async () => {
  const { extractRecipeFromHtml, parseLenientJson } = await import("./recipe-import");
  const { courseFromCategory } = await import("./courses");

  it("llegeix receptes amb salts de línia dins dels textos (cas TV3)", () => {
    const html = `<script type="application/ld+json">{
      "@context": "https://schema.org/",
      "@type": "Recipe",
      "name": "Llenties estofades",
      "recipeYield": "4",
      "totalTime": "PT0H30M",
      "cooktime": "PT0H20M",
      "recipeCategory": "Primer Plat",
      "image": "https://img.3cat.cat/llenties.jpg",
      "recipeIngredient": ["300 g de llenties pardines", "1 cabeça d'alls
", "1 ceba"],
      "recipeInstructions": "Bulliu les llenties.
Afegiu-hi el sofregit."
    }</script>`;
    const r = extractRecipeFromHtml(html, "https://www.3cat.cat/x")!;
    expect(r.title).toBe("Llenties estofades");
    expect(r.servings).toBe(4);
    expect(r.prepMinutes).toBe(30);
    expect(r.category).toBe("Primer Plat");
    expect(r.ingredients.map((i) => i.name)).toEqual(["llenties pardines", "cabeça d'alls", "ceba"]);
    expect(r.instructions).toBe("Bulliu les llenties.\nAfegiu-hi el sofregit.");
    expect(courseFromCategory(r.category)).toBe("primer");
  });

  it("separa els ingredients que venen en un sol text i treu les capçaleres (cas TV3)", () => {
    const html = `<script type="application/ld+json">{"@type": "Recipe", "name": "Crema de llenties", "recipeYield": "4",
      "recipeIngredient": ["1 RACIÓ
200 g llenties cuites&amp;nbsp;
50 ml llet de coco&amp;nbsp;

Per a la guarnició:
1 cullerada de cúrcuma"]}</script>`;
    const r = extractRecipeFromHtml(html, "https://www.3cat.cat/y")!;
    expect(r.ingredients.map((i) => [i.quantity, i.unit, i.name])).toEqual([
      [200, "g", "llenties cuites"],
      [50, "ml", "llet de coco"],
      [1, "cullerada", "cúrcuma"],
    ]);
  });

  it("corregeix comes sobrants i comentaris", () => {
    expect(parseLenientJson('{\n\t, "a": [1, 2, ], // nota\n "b": "x" }')).toEqual({ a: [1, 2], b: "x" });
    expect(parseLenientJson("{ això no és json")).toBeUndefined();
  });

  it("extreu els camps principals d'un bloc impossible de llegir (cas Javirecetas)", () => {
    const html = `<script type="application/ld+json">{
\t@context: "https://schema.org",
\t"@type": "Recipe",
\t"name": "Sopa de Calabaza Cl\\u00e1sica",
\t"image": { "@type": "ImageObject", "url": "https://www.javirecetas.com/sopa.jpg" },
\t"recipeYield": "4 raciones",
\t"recipeCategory": "Primeros",
\t"recipeIngredient": ["1 kg de calabaza", "1 l de caldo de pollo", "1 cucharadita de cúrcuma"],
\t"recipeInstructions": [{"@type": "HowToStep", "text": "Cortar la calabaza."}, {"@type": "HowToStep", "text": "Hervir."}]
}</script>`;
    const r = extractRecipeFromHtml(html, "https://www.javirecetas.com/sopa")!;
    expect(r.title).toBe("Sopa de Calabaza Clásica");
    expect(r.imageUrl).toBe("https://www.javirecetas.com/sopa.jpg");
    expect(r.servings).toBe(4);
    expect(r.ingredients).toHaveLength(3);
    expect(r.ingredients[0]).toMatchObject({ quantity: 1, unit: "kg", name: "calabaza" });
    expect(r.instructions).toBe("Cortar la calabaza.\nHervir.");
    expect(courseFromCategory(r.category)).toBe("primer");
  });
});

describe("cerca de receptes a webs", async () => {
  const { SITES, tv3Slug, queriesForImbalance } = await import("./recipe-sites");
  const site = (id: string) => SITES.find((s) => s.id === id)!;
  const imb = (over: object) => ({ needVeg: false, tooMuchGrain: false, refined: false, needProtein: false, tooMuchProtein: false, missingProteins: [], tooMuchRedMeat: false, ...over });

  it("tradueix termes a pàgines d'ingredient de Cuines (TV3)", () => {
    expect(tv3Slug("crema de calabacín")).toBe("carbasso");
    expect(tv3Slug("Merluza con verduras")).toBe("lluc");
    expect(tv3Slug("garbanzos con espinacas")).toBe("espinacs");
    expect(tv3Slug("quiche")).toBeNull();
    expect(site("tv3").searchUrl("quiche")).toBeNull();
    expect(site("tv3").searchUrl("lentejas")).toBe("https://www.3cat.cat/tv3/cuines/llentia/receptes/");
  });

  it("extreu adreces de receptes de cada web", () => {
    expect(site("tv3").extractLinks('<a href="/tv3/cuines/recepta/llenties-estofades/9141/">x</a><a href="/tv3/cuines/recepta/llenties-estofades/9141/">')).toEqual([
      "https://www.3cat.cat/tv3/cuines/recepta/llenties-estofades/9141/",
    ]);
    expect(site("cookpad").extractLinks('<a href="/es/recetas/26785527-lentejas">a</a><a href="/es/recetas/111">b</a>')).toEqual([
      "https://cookpad.com/es/recetas/26785527",
      "https://cookpad.com/es/recetas/111",
    ]);
    expect(
      site("rechupete").extractLinks(
        "https://www.abc.es/recetasderechupete/lentejas-estofadas/123/ https://www.abc.es/recetasderechupete/menu-semanal-economico/47186/",
      ),
    ).toEqual(["https://www.abc.es/recetasderechupete/lentejas-estofadas/123/"]);
    expect(site("pequerecetas").extractLinks('[{"link":"https://www.pequerecetas.com/receta/chili/"},{"link":"https://altra.com/x"}]')).toEqual([
      "https://www.pequerecetas.com/receta/chili/",
    ]);
    expect(site("javirecetas").extractLinks("<html>error</html>")).toEqual([]);
  });

  it("tria què buscar segons el desequilibri", () => {
    expect(queriesForImbalance(imb({ needVeg: true, missingProteins: ["peix"] }))[0]).toBe("merluza con verduras");
    expect(queriesForImbalance(imb({ missingProteins: ["llegum"] }))).toContain("lentejas con verduras");
    expect(queriesForImbalance(imb({ needProtein: true, tooMuchRedMeat: true }))).toEqual(["pollo al horno"]);
    expect(queriesForImbalance(imb({})).length).toBeGreaterThan(0);
    expect(queriesForImbalance(imb({ needVeg: true, needProtein: true, missingProteins: ["peix", "llegum"] })).length).toBeLessThanOrEqual(3);
  });
});

describe("rellevància dels resultats", async () => {
  const { queryKeywords, matchesKeywords, relevantFirst } = await import("./recipe-sites");
  it("descarta receptes que no tenen relació amb la cerca, en català o castellà", () => {
    const kws = queryKeywords("Merluza con verduras");
    expect(kws).toEqual(expect.arrayContaining(["merluza", "lluc"]));
    expect(matchesKeywords("Lluç a la planxa amb verdures", kws)).toBe(true);
    expect(matchesKeywords("Buñuelos de viento", queryKeywords("lentejas"))).toBe(false);
    expect(matchesKeywords("Amanida de llenties caviar", queryKeywords("lentejas"))).toBe(true);
    expect(relevantFirst(["https://x/bunuelos/1/", "https://x/lentejas-estofadas/2/"], queryKeywords("lentejas"))[0]).toBe("https://x/lentejas-estofadas/2/");
  });
});

describe("fotos pujades", async () => {
  const { fitWithin } = await import("./photo-upload");
  it("redueix les fotos grans mantenint la proporció i no amplia les petites", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
