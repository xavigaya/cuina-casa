import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFoodIndex, createNutritionCalculator, foodKey, matchFood, toGrams,
  type Food, type HarvardGroup, type NutritionRecipe,
} from "./nutrition";
import { countProteins, detectImbalance, evaluatePlate, proposeCompensation, type Candidate } from "./harvard";

/** Carrega els aliments de referència del mateix fitxer que genera la migració. */
function loadFoods(): Food[] {
  const tsv = readFileSync(path.resolve(__dirname, "../../supabase/data/aliments.tsv"), "utf8");
  return tsv
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l, i) => {
      const [name, aliases, kcal, carbs, protein, fat, fiber, group, unit_g, pack_g, density, plate] = l.split("\t");
      return {
        id: `f${i}`,
        household_id: null,
        name,
        aliases: aliases ? aliases.split(";").filter(Boolean) : [],
        kcal: +kcal, carbs: +carbs, protein: +protein, fat: +fat, fiber: +fiber,
        harvard_group: group as HarvardGroup,
        unit_g: unit_g ? +unit_g : null,
        pack_g: pack_g ? +pack_g : null,
        density: density ? +density : 1,
        plate_factor: plate ? +plate : 1,
      };
    });
}

const foods = loadFoods();
const index = buildFoodIndex(foods);
const food = (name: string) => foods.find((f) => f.name === name)!;

describe("taula d'aliments", () => {
  it("té entre 150 i 250 aliments amb valors coherents", () => {
    expect(foods.length).toBeGreaterThanOrEqual(150);
    expect(foods.length).toBeLessThanOrEqual(250);
    for (const f of foods) {
      expect(f.kcal, f.name).toBeGreaterThanOrEqual(0);
      // kcal ≈ 4·HC + 4·P + 9·G + 2·fibra (criteri europeu; marge per arrodoniments)
      const estimated = 4 * f.carbs + 4 * f.protein + 9 * f.fat + 2 * f.fiber;
      if (f.harvard_group !== "beguda" && f.kcal > 50) {
        expect(Math.abs(estimated - f.kcal) / f.kcal, f.name).toBeLessThan(0.3);
      }
    }
  });

  it("cap nom ni àlies no apunta a dos aliments diferents", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of foods) {
      for (const n of [f.name, ...f.aliases]) {
        const k = foodKey(n);
        const prev = seen.get(k);
        if (prev && prev !== f.name) clashes.push(`${n} (${prev} / ${f.name})`);
        seen.set(k, f.name);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe("conversió a grams", () => {
  it("converteix unitats de cuina", () => {
    expect(toGrams(2, "g", null).grams).toBe(2);
    expect(toGrams(0.5, "kg", null).grams).toBe(500);
    expect(toGrams(1, "cullerada", food("oli d'oliva")).grams).toBeCloseTo(13.8);
    expect(toGrams(1, "tassa", food("farina")).grams).toBeCloseTo(132);
    expect(toGrams(250, "ml", food("llet")).grams).toBeCloseTo(257.5);
    expect(toGrams(2, "u", food("ceba")).grams).toBe(300);
    expect(toGrams(3, "gra", food("all")).grams).toBe(15);
    expect(toGrams(1, "pessic", food("sal")).grams).toBe(0.5);
    expect(toGrams(1, "llauna", food("tomàquet triturat")).grams).toBe(400);
    expect(toGrams(1, "llauna", food("tonyina en llauna")).grams).toBe(60);
    expect(toGrams(2, "llesca", food("pa de motlle")).grams).toBe(50);
  });

  it("les quantitats vagues compten zero i els pesos desconeguts es marquen", () => {
    expect(toGrams(null, null, food("sal"))).toEqual({ grams: 0, vague: true });
    expect(toGrams(1, "u", food("espinacs")).grams).toBeNull();
  });
});

describe("cerca d'aliments", () => {
  it("troba l'aliment pel nom, àlies o paraules senceres", () => {
    const m = (n: string) => matchFood(index, n)?.name;
    expect(m("Cebes")).toBe("ceba");
    expect(m("oli d'oliva verge extra")).toBe("oli d'oliva");
    expect(m("aceite de oliva virgen extra")).toBe("oli d'oliva");
    expect(m("pit de pollastre a daus")).toBe("pit de pollastre");
    expect(m("tomàquets madurs")).toBe("tomàquet");
    expect(m("pa ratllat")).toBe("pa ratllat");
    expect(m("nou moscada")).toBe("nou moscada");
    expect(m("salsa de soja")).toBe("salsa de soja");
    expect(m("macarrons")).toBe("pasta");
    expect(m("espaguetis integrals")).toBe("pasta integral");
    expect(m("garbanzos cocidos")).toBe("cigrons cuits");
    expect(m("una cosa inventada")).toBeUndefined();
  });

  it("els aliments propis de la llar tenen prioritat", () => {
    const own: Food = { ...food("pa"), id: "meu", household_id: "llar", kcal: 999 };
    expect(matchFood(buildFoodIndex([...foods, own]), "pa")?.kcal).toBe(999);
  });
});

describe("càlcul de receptes", () => {
  const macarrons: NutritionRecipe = {
    id: "macarrons",
    title: "Macarrons amb tomàquet",
    servings: 4,
    ingredients: [
      { name: "macarrons", quantity: 400, unit: "g" },
      { name: "tomàquet triturat", quantity: 1, unit: "llauna" },
      { name: "ceba", quantity: 1, unit: "u" },
      { name: "oli d'oliva", quantity: 2, unit: "cullerada" },
      { name: "sal", quantity: null, unit: null },
      { name: "formatge ratllat", quantity: 40, unit: "g", optional: true },
    ],
  };

  it("calcula els valors per ració", () => {
    const calc = createNutritionCalculator(new Map([[macarrons.id, macarrons]]), index);
    const r = calc.byId("macarrons")!;
    // 400 g pasta (1484) + 400 g tomàquet (128) + 150 g ceba (60) + 27,6 g oli (244) ≈ 1916 kcal / 4
    expect(r.perServing.kcal).toBeGreaterThan(460);
    expect(r.perServing.kcal).toBeLessThan(500);
    expect(r.perServing.carbs).toBeCloseTo((400 * 0.718 + 400 * 0.051 + 150 * 0.076) / 4, 0);
    expect(r.incomplete).toBe(false);
    // pasta seca ×2,5 al plat
    expect(r.plate.cereal_refinat).toBeCloseTo(250);
    expect(r.plate.verdura).toBeCloseTo((400 + 150) / 4);
  });

  it("marca com a incomplet el que no troba, sense fallar", () => {
    const r = createNutritionCalculator(new Map(), index).compute({
      id: "x",
      title: "X",
      servings: 2,
      ingredients: [
        { name: "ceba", quantity: 1, unit: "u" },
        { name: "pols màgica", quantity: 10, unit: "g" },
        { name: "espinacs", quantity: 2, unit: "u" },
        { name: "pebre", quantity: null, unit: null },
      ],
    });
    expect(r.incomplete).toBe(true);
    expect(r.missing).toEqual([
      { name: "pols màgica", reason: "sense_dades" },
      { name: "espinacs", reason: "sense_pes" },
    ]);
    expect(r.perServing.kcal).toBeCloseTo(30);
  });

  it("calcula els preelaborats a partir de la seva recepta, recursivament", () => {
    const brou: NutritionRecipe = {
      id: "brou", title: "Brou", servings: 4, yield_quantity: 2, yield_unit: "l",
      ingredients: [{ name: "pastanaga", quantity: 200, unit: "g" }, { name: "ceba", quantity: 1, unit: "u" }],
    };
    const sofregit: NutritionRecipe = {
      id: "sofregit", title: "Sofregit", servings: 4, yield_quantity: 500, yield_unit: "g",
      ingredients: [
        { name: "tomàquet", quantity: 1, unit: "kg" },
        { name: "ceba", quantity: 2, unit: "u" },
        { name: "oli d'oliva", quantity: 100, unit: "ml" },
      ],
    };
    const arros: NutritionRecipe = {
      id: "arros", title: "Arròs", servings: 4,
      ingredients: [
        { name: "arròs", quantity: 400, unit: "g" },
        { name: "sofregit", quantity: 200, unit: "g", sub_recipe_id: "sofregit" },
        { name: "brou", quantity: 1, unit: "l", sub_recipe_id: "brou" },
      ],
    };
    const calc = createNutritionCalculator(new Map([brou, sofregit, arros].map((r) => [r.id, r])), index);
    const s = calc.byId("sofregit")!;
    const b = calc.byId("brou")!;
    const a = calc.byId("arros")!;
    const arrosSol = (400 * 360) / 100;
    // 200 g de 500 g de sofregit = 40 %; 1 l de 2 l de brou = 50 %
    expect(a.total.kcal).toBeCloseTo(arrosSol + s.total.kcal * 0.4 + b.total.kcal * 0.5, 5);
    expect(a.plate.verdura).toBeCloseTo((s.plate.verdura! * 4 * 0.4 + b.plate.verdura! * 4 * 0.5) / 4, 5);
  });

  it("sense rendiment, fa servir el pes dels ingredients o les racions", () => {
    const salsa: NutritionRecipe = {
      id: "salsa", title: "Salsa", servings: 2,
      ingredients: [{ name: "tomàquet", quantity: 300, unit: "g" }, { name: "oli d'oliva", quantity: 100, unit: "g" }],
    };
    const plat: NutritionRecipe = {
      id: "plat", title: "Plat", servings: 2,
      ingredients: [
        { name: "salsa", quantity: 200, unit: "g", sub_recipe_id: "salsa" }, // la meitat de 400 g
        { name: "salsa", quantity: 1, unit: "u", sub_recipe_id: "salsa" }, // mateixes racions: tota
      ],
    };
    const calc = createNutritionCalculator(new Map([salsa, plat].map((r) => [r.id, r])), index);
    expect(calc.byId("plat")!.total.kcal).toBeCloseTo(calc.byId("salsa")!.total.kcal * 1.5, 5);
  });

  it("no entra en bucle amb receptes que es fan servir mútuament", () => {
    const a: NutritionRecipe = { id: "a", title: "A", servings: 1, ingredients: [{ name: "b", quantity: 100, unit: "g", sub_recipe_id: "b" }, { name: "ceba", quantity: 1, unit: "u" }] };
    const b: NutritionRecipe = { id: "b", title: "B", servings: 1, ingredients: [{ name: "a", quantity: 100, unit: "g", sub_recipe_id: "a" }] };
    const calc = createNutritionCalculator(new Map([a, b].map((r) => [r.id, r])), index);
    expect(calc.byId("a")!.perServing.kcal).toBeGreaterThan(0);
  });
});

describe("Plat de Harvard", () => {
  it("detecta un plat de pasta desequilibrat", () => {
    const e = evaluatePlate({ cereal_refinat: 250, verdura: 80 });
    expect(e.advice.map((a) => a.code)).toEqual(expect.arrayContaining(["falta_verdura", "massa_cereal", "millor_integral", "falta_proteina"]));
    expect(e.status).toBe("desequilibrat");
  });

  it("reconeix un plat equilibrat", () => {
    const e = evaluatePlate({ verdura: 200, cereal_integral: 100, peix: 100 });
    expect(e.status).toBe("equilibrat");
    expect(e.advice[0].code).toBe("equilibrat");
    expect(e.score).toBe(100);
  });

  it("les patates no compten com a verdura", () => {
    const e = evaluatePlate({ patata: 200, verdura: 40, carn_vermella: 120 });
    expect(e.advice.map((a) => a.code)).toEqual(expect.arrayContaining(["falta_verdura", "patates", "carn_vermella"]));
  });

  it("no avalua postres ni salses amb poca quantitat", () => {
    expect(evaluatePlate({ sucre: 50, lactic: 20 }).status).toBe("no_avaluable");
  });
});

describe("propostes compensatòries", () => {
  const candidates: Candidate[] = [
    { id: "crema", title: "Crema de carbassó", course: "primer", plate: { verdura: 300, patata: 50 } },
    { id: "truita", title: "Truita de patates", course: "segon", plate: { ou: 120, patata: 100 } },
    { id: "lluc", title: "Lluç al forn", course: "segon", plate: { peix: 150, verdura: 60 } },
    { id: "pasta", title: "Espaguetis carbonara", course: "plat_unic", plate: { cereal_refinat: 250, carn_processada: 40 } },
    { id: "pastis", title: "Pastís", course: "postres", plate: { sucre: 80, cereal_refinat: 60 } },
  ];

  it("proposa verdura i proteïna per al sopar si el dinar era de pasta", () => {
    const imb = detectImbalance({ cereal_refinat: 250, verdura: 60, lactic: 10 })!;
    expect(imb.needVeg && imb.tooMuchGrain && imb.refined && imb.needProtein).toBe(true);
    const props = proposeCompensation(imb, candidates, "dia");
    expect(props[0].recipes.map((r) => r.id)).toEqual(["crema", "lluc"]);
    expect(props[0].reason).toMatch(/^Avui has menjat poca verdura/);
    expect(props.flatMap((p) => p.recipes.map((r) => r.id))).not.toContain("pasta");
    expect(props.flatMap((p) => p.recipes.map((r) => r.id))).not.toContain("pastis");
  });

  it("no proposa res si el dia ja és equilibrat i hi ha varietat", () => {
    expect(detectImbalance({ verdura: 200, cereal_integral: 100, peix: 100 }, { peix: 2, llegum: 2, ou: 1, aviram: 1, carn_vermella: 0 })).toBeNull();
  });

  it("té en compte la varietat de proteïnes de la setmana", () => {
    const week = countProteins([{ carn_vermella: 120 }, { carn_vermella: 100 }, { aviram: 150 }]);
    expect(week).toMatchObject({ carn_vermella: 2, aviram: 1, peix: 0 });
    const imb = detectImbalance({ verdura: 200, cereal_integral: 100, aviram: 100 }, week)!;
    expect(imb.missingProteins).toEqual(["peix", "llegum"]);
    expect(imb.tooMuchRedMeat).toBe(true);
    const props = proposeCompensation(imb, candidates, "setmana");
    expect(props[0].recipes[0].id).toBe("lluc");
    expect(props[0].reason).toBe("Aquesta setmana encara falta peix i llegums");
  });
});

describe("anàlisi del menú setmanal", async () => {
  const { analyzeWeek } = await import("./menu-analysis");
  const results: Record<string, { perServing: { kcal: number; carbs: number; protein: number; fat: number; fiber: number }; plate: Record<string, number>; incomplete: boolean }> = {
    pasta: { perServing: { kcal: 600, carbs: 90, protein: 18, fat: 15, fiber: 5 }, plate: { cereal_refinat: 250, verdura: 50 }, incomplete: false },
    crema: { perServing: { kcal: 150, carbs: 15, protein: 4, fat: 8, fiber: 4 }, plate: { verdura: 300 }, incomplete: false },
    lluc: { perServing: { kcal: 250, carbs: 5, protein: 30, fat: 12, fiber: 2 }, plate: { peix: 150, verdura: 60 }, incomplete: true },
    vedella: { perServing: { kcal: 400, carbs: 0, protein: 35, fat: 25, fiber: 0 }, plate: { carn_vermella: 150 }, incomplete: false },
  };
  const nutritionOf = (id: string) => (results[id] ? { servings: 1, total: results[id].perServing, totalGrams: 0, missing: [], ...results[id] } : null);
  const candidates = [
    { id: "crema", title: "Crema de carbassó", course: "primer", plate: results.crema.plate },
    { id: "lluc", title: "Lluç al forn", course: "segon", plate: results.lluc.plate },
  ];
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

  it("suma per dia, fa la mitjana i proposa un sopar compensatori", () => {
    const w = analyzeWeek(
      [
        { day: days[0], meal: "dinar", recipe_id: "pasta" },
        { day: days[1], meal: "dinar", recipe_id: "crema" },
        { day: days[1], meal: "dinar", recipe_id: "lluc" },
        { day: days[1], meal: "sopar", recipe_id: null },
      ],
      days,
      days[0],
      nutritionOf,
      candidates,
    );
    expect(w.days[0].totals.kcal).toBe(600);
    expect(w.days[1].totals.kcal).toBe(400);
    expect(w.days[1].incomplete).toBe(true);
    expect(w.days[1].unknown).toBe(1);
    expect(w.average!.kcal).toBe(500);
    expect(w.daysWithData).toBe(2);
    // Dilluns: dinar de pasta i sopar buit → proposta de verdura + peix
    expect(w.days[0].proposals[0].recipes.map((r) => r.id)).toEqual(["crema", "lluc"]);
    // Dimarts ja té sopar: cap proposta
    expect(w.days[1].proposals).toEqual([]);
  });

  it("al cap de setmana proposa equilibrar el balanç de la setmana", () => {
    const w = analyzeWeek(
      [0, 1, 2, 3].map((i) => ({ day: days[i], meal: "dinar" as const, recipe_id: i % 2 ? "vedella" : "pasta" })),
      days,
      days[5],
      nutritionOf,
      candidates,
    );
    expect(w.proteins.carn_vermella).toBe(2);
    expect(w.weekend.slots).toHaveLength(4);
    expect(w.weekend.imbalance?.needVeg).toBe(true);
    expect(w.weekend.proposals.length).toBeGreaterThan(0);
    expect(w.weekend.proposals[0].reason).toMatch(/^Aquesta setmana has menjat poca verdura/);
  });
});

describe("Open Food Facts", async () => {
  const { parseOffNutrition, groupFromCategories } = await import("./off");
  it("llegeix els valors per 100 g i endevina el grup", () => {
    const n = parseOffNutrition(
      {
        nutriments: { "energy-kcal_100g": 350, carbohydrates_100g: 64, proteins_100g: 13, fat_100g: 2.5, fiber_100g: 8 },
        categories_tags: ["en:plant-based-foods", "en:pastas", "en:whole-grain-pastas"],
        product_quantity: 500,
        product_quantity_unit: "g",
      },
      "Macarrones integrales",
    );
    expect(n).toEqual({ kcal: 350, carbs: 64, protein: 13, fat: 2.5, fiber: 8, harvard_group: "cereal_integral", pack_g: 500 });
  });

  it("calcula les kcal des dels kJ i no falla si falten dades", () => {
    expect(parseOffNutrition({ nutriments: { "energy-kj_100g": 418.4, carbohydrates_100g: 1, proteins_100g: 1, fat_100g: 1 } }, "x")?.kcal).toBe(100);
    expect(parseOffNutrition({ nutriments: { "energy-kcal_100g": 100 } }, "x")).toBeNull();
    expect(parseOffNutrition(null, "x")).toBeNull();
  });

  it("classifica per categories", () => {
    expect(groupFromCategories(["en:meats", "en:prepared-meats", "en:hams"], "Jamón")).toBe("carn_processada");
    expect(groupFromCategories(["en:seafood", "en:canned-fishes", "en:tunas"], "Atún")).toBe("peix");
    expect(groupFromCategories(["en:beverages", "en:fruit-juices"], "Zumo")).toBe("beguda");
    expect(groupFromCategories([], "Llet sencera")).toBe("lactic");
  });
});

describe("unificar ingredients semblants", async () => {
  const { findSimilarNames, levenshtein } = await import("./ingredient-unify");
  const use = (name: string, n = 1, recipe = "R") => ({
    name,
    recipes: [recipe],
    refs: Array.from({ length: n }, (_, i) => ({ table: "recipe_ingredients" as const, id: `${name}-${i}` })),
  });

  it("proposa variants, grafies i errates, i no barreja aliments coneguts diferents", () => {
    const props = findSimilarNames(
      [
        use("ceba", 5), use("Ceba dolça", 2), use("cebes", 1), use("ceba tendra", 2),
        use("julivert", 3), use("fulles de julivert", 1), use("julivet", 1),
        use("tomàquet", 4), use("tomàquet triturat", 2),
        use("pebre", 2), use("pebre vermell", 1),
        use("arròs", 3),
      ],
      index,
    );
    const byTarget = Object.fromEntries(props.map((p) => [p.target, p.members.map((m) => m.name)]));
    expect(byTarget["ceba"]).toEqual(["ceba", "Ceba dolça", "cebes"]);
    expect(byTarget["julivert"]).toEqual(expect.arrayContaining(["julivert", "fulles de julivert", "julivet"]));
    expect(Object.keys(byTarget)).toHaveLength(2); // ni tomàquet triturat, ni pebre vermell, ni ceba tendra
    expect(props.find((p) => p.target === "ceba")!.members.find((m) => m.name === "ceba")!.count).toBe(5);
  });

  it("agrupa només per grafia quan el nom és el mateix", () => {
    const [p] = findSimilarNames([use("Llenties", 1), use("llentia", 2), use("llenties", 1)], index);
    expect(p.target).toBe("llentia");
    expect(p.members.find((m) => m.name === "Llenties")!.count).toBe(2); // «Llenties» i «llenties» són el mateix text
    const [g] = findSimilarNames([use("Cebes", 1), use("ceba", 3)], index);
    expect(g.reason).toBe("grafia");
    expect(g.target).toBe("ceba");
  });

  it("calcula la distància d'edició", () => {
    expect(levenshtein("julivet", "julivert")).toBe(1);
    expect(levenshtein("ceba", "ceba")).toBe(0);
  });
});
