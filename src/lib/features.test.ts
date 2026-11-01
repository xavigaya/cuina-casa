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

describe("traducció al català", async () => {
  const { looksSpanish } = await import("./translate");
  const { translateLines, translateRecipeToCatalan } = await import("./translate-server");
  const { vi, afterEach } = await import("vitest");

  /** Simula Apertium: tradueix algunes paraules i compta les crides. */
  function mockApertium(dict: Record<string, string>, opts: { breakLines?: boolean; fail?: boolean } = {}) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const q = new URLSearchParams(init.body).get("q") ?? "";
      calls.push(q);
      if (opts.fail) return new Response("", { status: 503 });
      let out = q.split("\n").map((l) => Object.entries(dict).reduce((acc, [es, ca]) => acc.replaceAll(es, ca), l)).join("\n");
      if (opts.breakLines && q.includes("\n")) out = out.replace("\n", " ");
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: out } }), { status: 200 });
    });
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("detecta receptes en castellà i no confon el català", () => {
    expect(looksSpanish("Lentejas con verduras\n200 g de lentejas\n1 cebolla\nAñadir el aceite y cocinar 20 minutos")).toBe(true);
    expect(looksSpanish("Llenties amb verdures\n200 g de llenties\n1 ceba\nAfegiu-hi l'oli i deixeu-ho coure 20 minuts")).toBe(false);
    expect(looksSpanish("Amanida de llenties caviar")).toBe(false);
    expect(looksSpanish("Paella")).toBe(false);
  });

  it("tradueix línies juntes i, si no quadren, d'una en una", async () => {
    let calls = mockApertium({ cebolla: "ceba", aceite: "oli" });
    expect(await translateLines(["1 cebolla", "aceite de oliva"])).toEqual(["1 ceba", "oli de oliva"]);
    expect(calls).toHaveLength(1);
    calls = mockApertium({ cebolla: "ceba" }, { breakLines: true });
    expect(await translateLines(["1 cebolla", "sal"])).toEqual(["1 ceba", "sal"]);
    expect(calls).toHaveLength(3);
    mockApertium({}, { fail: true });
    expect(await translateLines(["hola"])).toBeNull();
  });

  it("tradueix títol, ingredients i passos, i manté les quantitats", async () => {
    mockApertium({ "Lentejas con verduras": "llenties amb verdures", lentejas: "llenties", cebolla: "ceba", "Cortar la": "Tallar la", "y cocinar": "i coure" });
    const r = {
      title: "Lentejas con verduras",
      servings: 4,
      prepMinutes: 30,
      imageUrl: null,
      sourceUrl: "https://x",
      instructions: "Cortar la cebolla.\nAñadir las lentejas y cocinar.",
      ingredients: [
        { name: "lentejas", quantity: 300, unit: "g" as const, section: "rebost" as const, optional: false },
        { name: "cebolla", quantity: 1, unit: "u" as const, section: "fruita" as const, optional: false },
      ],
    };
    const { recipe, translated } = await translateRecipeToCatalan(r);
    expect(translated).toBe(true);
    expect(recipe.title).toBe("Llenties amb verdures");
    expect(recipe.ingredients.map((i) => [i.quantity, i.unit, i.name])).toEqual([[300, "g", "llenties"], [1, "u", "ceba"]]);
    expect(recipe.instructions).toBe("Tallar la ceba.\nAñadir las llenties i coure.");
  });

  it("corregeix paraules de cuina que el traductor deixa en castellà", async () => {
    const { fixCatalanTranslation } = await import("./translate");
    expect(fixCatalanTranslation("taronges grans (1 cucharadita de ralladura)")).toBe("taronges grans (1 culleradeta de ratlladura)");
    expect(fixCatalanTranslation("Lava la carabassa i afegeix un *chorrito d'oli")).toBe("Renta la carabassa i afegeix un rajolí d'oli");
    expect(fixCatalanTranslation("ceba gran (aproximadament 150 #g)")).toBe("ceba gran (aproximadament 150 g)");
  });

  it("no toca les receptes que ja són en català ni falla si el traductor no respon", async () => {
    const calls = mockApertium({});
    const ca = { title: "Llenties estofades", servings: 4, prepMinutes: null, imageUrl: null, sourceUrl: "x", instructions: "Bulliu les llenties amb la ceba.", ingredients: [{ name: "llenties", quantity: 300, unit: "g" as const, section: "rebost" as const, optional: false }] };
    expect((await translateRecipeToCatalan(ca)).translated).toBe(false);
    expect(calls).toHaveLength(0);
    mockApertium({}, { fail: true });
    const es = { ...ca, title: "Lentejas con cebolla y aceite", instructions: "Cocinar las lentejas con el aceite." };
    const res = await translateRecipeToCatalan(es);
    expect(res.translated).toBe(false);
    expect(res.recipe.title).toBe("Lentejas con cebolla y aceite");
  });
});

describe("duplicar receptes", async () => {
  const { draftFromRecipe, resolveLink, splitSteps } = await import("./recipes");
  const { parseIngredientLine } = await import("./ingredients");
  it("la còpia conserva ingredients, passos, tipus de plat, foto i enllaços amb preelaborats", () => {
    const original = {
      id: "r1", household_id: "h", title: "Arròs a la cassola", servings: 4, prep_minutes: 40, instructions: "Sofregiu.\nAfegiu l'arròs.",
      source_url: null, image_url: "https://foto/arros.webp", tags: ["diumenge"], course: "plat_unic" as const, is_component: false,
      yield_quantity: null, yield_unit: null, created_at: "", status: "aprovada" as const, created_by: null,
      recipe_ingredients: [
        { id: "a", recipe_id: "r1", position: 1, name: "sofregit", quantity: 200, unit: "g", section: "altres", optional: false, sub_recipe_id: "sofregit" },
        { id: "b", recipe_id: "r1", position: 0, name: "arròs", quantity: 400, unit: "g", section: "rebost", optional: false, sub_recipe_id: null },
      ],
    };
    const d = draftFromRecipe(original);
    expect(d.ingredientLines).toBe("400 g d'arròs\n200 g de sofregit");
    expect(splitSteps(d.instructions)).toEqual(["Sofregiu.", "Afegiu l'arròs."]);
    expect(d).toMatchObject({ course: "plat_unic", image_url: "https://foto/arros.webp", tags: ["diumenge"], servings: 4 });
    const lines = d.ingredientLines.split("\n").map((l) => parseIngredientLine(l)!);
    expect(lines.map((p) => resolveLink(p.name, d.links, []))).toEqual([null, "sofregit"]);
  });
});

describe("plats del menú sense recepta", async () => {
  const { groupDishes, dishKey } = await import("./dishes-without-recipe");
  it("agrupa pel nom sense distingir majúscules ni accents i ordena per data", () => {
    const today = "2026-11-04";
    const g = groupDishes(
      [
        { id: "1", note: "Truita de patates", day: "2026-11-02" },
        { id: "2", note: "truita de patates ", day: "2026-11-06" },
        { id: "3", note: "Macarrons de l'àvia", day: "2026-11-05" },
        { id: "4", note: "Sopa", day: "2026-10-30" },
        { id: "5", note: "  ", day: "2026-11-05" },
        { id: "6", note: null, day: "2026-11-05" },
      ],
      today,
    );
    expect(g.map((d) => [d.name, d.count, d.day])).toEqual([
      ["Macarrons de l'àvia", 1, "2026-11-05"],
      ["Truita de patates", 2, "2026-11-06"],
      ["Sopa", 1, "2026-10-30"],
    ]);
    expect(g[1].entryIds).toEqual(["1", "2"]);
    expect(dishKey("Macarrons de l'Àvia")).toBe(dishKey("macarrons de l avia"));
  });
});

describe("proposta de valors nutricionals (Open Food Facts)", async () => {
  const { proposalFromProducts, significantWords } = await import("./food-lookup");
  const { groupFromCategories } = await import("./off");
  const p = (name: string, kcal: number, carbs: number, protein: number, fat: number, fiber: number, tags: string[] = []) => ({
    product_name: name,
    nutriments: { "energy-kcal_100g": kcal, carbohydrates_100g: carbs, proteins_100g: protein, fat_100g: fat, fiber_100g: fiber },
    categories_tags: tags,
  });

  it("fa la mitjana dels productes relacionats i descarta la resta", () => {
    const r = proposalFromProducts("farina d'espelta", ["harina de espelta", "farina d'espelta"], [
      p("Harina de espelta integral", 335, 62, 14, 2.5, 10, ["en:cereals-and-potatoes", "en:flours"]),
      p("Harina de Espelta", 340, 66, 12, 2, 7, ["en:cereals-and-potatoes", "en:flours"]),
      p("Harina de espelta blanca", 345, 70, 11, 1.5, 4, ["en:flours"]),
      p("Galletas de espelta", 470, 65, 8, 19, 5, ["en:biscuits"]), // no hi ha «harina»
      p("Harina de espelta", 0, 0, 0, 0, 0).nutriments ? { product_name: "Harina de espelta sense dades" } : {},
    ]);
    expect(r).toMatchObject({ kcal: 340, carbs: 66, protein: 12, fat: 2, fiber: 7, harvard_group: "cereal_refinat", samples: 3 });
    expect(proposalFromProducts("pols màgica", ["polvo magico"], [p("Harina", 340, 70, 10, 1, 3)])).toBeNull();
    expect(significantWords("Llet de coco")).toEqual(["llet", "coco"]);
  });

  it("no confon la categoria «cereals i patates» amb les patates", () => {
    expect(groupFromCategories(["en:plant-based-foods", "en:cereals-and-potatoes", "en:flours"], "Harina")).toBe("cereal_refinat");
    expect(groupFromCategories(["en:cereals-and-potatoes", "en:meat-analogues", "en:seitan"], "Seitán")).toBe("llegum");
    expect(groupFromCategories(["en:cereals-and-potatoes", "en:potatoes"], "Patatas")).toBe("patata");
    expect(groupFromCategories(["en:plant-based-milks", "en:coconut-milks"], "Leche de coco")).toBe("greix");
  });
});

describe("receptes que cal revisar", async () => {
  const { recipeIssues, needsReview, issuesLabel } = await import("./recipe-issues");
  it("detecta ingredients sense dades, sense pes, sense ingredients o sense passos", () => {
    const missing = [
      { name: "pols màgica", reason: "sense_dades" as const },
      { name: "Pols màgica", reason: "sense_dades" as const, in: "Salsa" },
      { name: "espinacs", reason: "sense_pes" as const },
    ];
    const a = recipeIssues({ instructions: "Barregeu-ho tot." }, 5, { missing });
    expect(a).toEqual({ unknown: 1, noWeight: 1, noIngredients: false, noSteps: false });
    expect(issuesLabel(a)).toBe("2 ingredients sense dades");
    const b = recipeIssues({ instructions: null }, 0, null);
    expect(needsReview(b)).toBe(true);
    expect(issuesLabel(b)).toBe("Sense ingredients");
    expect(issuesLabel(recipeIssues({ instructions: "  \n " }, 3, { missing: [] }))).toBe("Sense passos");
    const ok = recipeIssues({ instructions: "1. Cuineu." }, 3, { missing: [] });
    expect(needsReview(ok)).toBe(false);
    expect(issuesLabel(ok)).toBeNull();
  });
});

describe("adreces privades de Vercel", async () => {
  const { isPrivateVercelHost } = await import("./site-url");
  it("distingeix l'adreça pública de les de desplegament", () => {
    expect(isPrivateVercelHost("cuina-casa.vercel.app")).toBe(false);
    expect(isPrivateVercelHost("cuina-casa-git-main-xavigayas-projects.vercel.app")).toBe(true);
    expect(isPrivateVercelHost("cuina-casa-a1b2c3d4e-xavigayas-projects.vercel.app")).toBe(true);
    expect(isPrivateVercelHost("localhost")).toBe(false);
  });
});
