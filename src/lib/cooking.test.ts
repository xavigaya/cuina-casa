import { describe, expect, it } from "vitest";
import { convertQuantity, expandUses, formatClock, parseDurations, planCooking, suggestForExpiring, templateToRows, weekToTemplate, type StockRow } from "./cooking";
import { buildFoodIndex, type Food } from "./nutrition";
import type { RecipeNode } from "./shopping";

describe("temporitzadors", () => {
  const secs = (t: string) => parseDurations(t).map((d) => d.seconds);
  it("troba les durades en català i en castellà", () => {
    expect(secs("Couen 20 minuts a foc lent.")).toEqual([1200]);
    expect(secs("Deixeu reposar 1 hora i mitja")).toEqual([5400]);
    expect(secs("mitja hora al forn")).toEqual([1800]);
    expect(secs("a 180 graus durant tres quarts d'hora")).toEqual([2700]);
    expect(secs("durant cinc minuts")).toEqual([300]);
    expect(secs("Cal 1 h 30 min")).toEqual([5400]);
    expect(secs("Fregiu 30 segundos y luego 2 minutos más")).toEqual([30, 120]);
  });
  it("en un interval, avisa al primer temps", () => {
    expect(parseDurations("Bulliu-ho 10-15 min")).toEqual([{ seconds: 600, label: "10-15 min" }]);
    expect(secs("Cuece de 8 a 10 minutos")).toEqual([480]);
  });
  it("no confon quantitats amb temps", () => {
    expect(secs("Talleu 2 cebes i 3 grans d'all")).toEqual([]);
    expect(secs("afegiu 2 l d'aigua i 200 g de sucre")).toEqual([]);
  });
  it("formata el compte enrere", () => {
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

const food = (name: string, extra: Partial<Food> = {}): Food =>
  ({ id: name, household_id: null, name, aliases: [], kcal: 0, carbs: 0, protein: 0, fat: 0, fiber: 0, harvard_group: "verdura", unit_g: null, pack_g: null, density: 1, plate_factor: 1, barcode: null, source: "referència", ...extra }) as Food;

const stock = (name: string, quantity: number | null, unit: string | null, extra: Partial<StockRow> = {}): StockRow => ({
  id: name + (extra.expires_on ?? ""),
  name,
  quantity,
  unit,
  location: "rebost",
  expires_on: null,
  min_quantity: null,
  ...extra,
});

describe("descomptar del rebost en cuinar", () => {
  const recipes = new Map<string, RecipeNode>([
    [
      "macarrons",
      {
        id: "macarrons",
        title: "Macarrons",
        servings: 4,
        yield_quantity: null,
        yield_unit: null,
        ingredients: [
          { name: "macarrons", quantity: 400, unit: "g" },
          { name: "sofregit", quantity: 200, unit: "g", sub_recipe_id: "sofregit" },
          { name: "ceba", quantity: 1, unit: null },
          { name: "sal", quantity: null, unit: null },
          { name: "formatge ratllat", quantity: 50, unit: "g", optional: true },
        ],
      },
    ],
    [
      "sofregit",
      {
        id: "sofregit",
        title: "Sofregit de tomata",
        servings: 4,
        yield_quantity: 400,
        yield_unit: "g",
        ingredients: [
          { name: "tomàquet triturat", quantity: 800, unit: "g" },
          { name: "ceba", quantity: 2, unit: null },
        ],
      },
    ],
  ]);
  const foods = buildFoodIndex([food("ceba", { unit_g: 150 })]);

  it("escala les racions i desplega el preelaborat si no n'hi ha a casa", () => {
    const uses = expandUses("macarrons", 2, recipes, [], 4);
    const byName = Object.fromEntries(uses.map((u) => [u.name, u.quantity]));
    expect(byName["macarrons"]).toBe(200);
    expect(byName["tomàquet triturat"]).toBe(200); // 100 g de sofregit = 1/4 de la recepta
    expect(uses.filter((u) => u.name === "ceba").map((u) => u.quantity)).toEqual([0.5, 0.5]);
    expect(uses.some((u) => u.name === "formatge ratllat")).toBe(false); // opcional
  });

  it("si el preelaborat és al rebost, es gasta d'allà", () => {
    const uses = expandUses("macarrons", 4, recipes, [{ name: "Sofregit de tomata", quantity: 300 }], 4);
    expect(uses.find((u) => u.keys.includes("sofregit de tomata"))?.quantity).toBe(200);
    expect(uses.some((u) => u.name === "tomàquet triturat")).toBe(false);
  });

  it("converteix unitats i gasta primer el que caduca abans", () => {
    const pantry = [
      stock("macarrons", 1, "kg"),
      stock("ceba", 600, "g"),
      stock("tomàquet triturat", 400, "g", { expires_on: "2026-12-01" }),
      stock("tomàquet triturat", 400, "g", { expires_on: "2026-11-05" }),
      stock("sal", null, null),
    ];
    const plan = planCooking(expandUses("macarrons", 4, recipes, pantry, 4), pantry, foods);
    const after = Object.fromEntries(plan.deductions.map((d) => [d.item.id, d.after]));
    expect(after["macarrons"]).toBe(0.6); // 1 kg − 400 g, en kg
    expect(after["ceba"]).toBe(300); // 1 ceba del plat + 1 del mig sofregit, de 150 g
    expect(after["tomàquet triturat2026-11-05"]).toBe(0); // primer el que caduca abans
    expect(after["tomàquet triturat2026-12-01"]).toBeUndefined(); // no cal tocar-lo
    expect(plan.vague).toEqual(["sal"]);
  });

  it("si les unitats no es poden comparar, ho proposa sense donar-ho per segur", () => {
    const plan = planCooking([{ name: "julivert", keys: ["julivert"], quantity: 2, unit: "cullerada", recipe: "x" }], [stock("julivert", 1, "manat")], null);
    expect(plan.deductions[0].sure).toBe(true); // manat → 100 g, cullerada → 15 ml ≈ 15 g
    const unknown = planCooking([{ name: "ou", keys: ["ou"], quantity: 2, unit: null, recipe: "x" }], [stock("ou", 300, "g")], null);
    expect(unknown.deductions[0].sure).toBe(false);
    expect(unknown.deductions[0].after).toBe(300);
    expect(planCooking([{ name: "pebre", keys: ["pebre"], quantity: 1, unit: "g", recipe: "x" }], [], null).notAtHome).toEqual(["pebre"]);
  });

  it("converteix quantitats entre unitats compatibles", () => {
    expect(convertQuantity(250, "ml", "l", null)).toBe(0.25);
    expect(convertQuantity(2, null, "g", { unit_g: 60, pack_g: null, density: 1 })).toBe(120);
    expect(convertQuantity(2, null, "g", null)).toBeNull();
  });
});

describe("aprofitar el que caduca", () => {
  const recipes = [
    { id: "a", title: "Crema d'espinacs", ingredients: [{ name: "espinacs baby" }, { name: "nata" }, { name: "ceba" }] },
    { id: "b", title: "Truita", ingredients: [{ name: "ous" }, { name: "patates" }] },
    { id: "c", title: "Canelons d'espinacs", ingredients: [{ name: "espinacs" }, { name: "nata" }, { name: "pasta de canelons" }, { name: "beixamel" }] },
    { id: "d", title: "Sofregit", is_component: true, ingredients: [{ name: "espinacs" }] },
  ];
  it("prioritza les receptes que gasten més del que caduca i a les que falta menys", () => {
    const s = suggestForExpiring([{ name: "Espinacs" }, { name: "Nata" }], recipes, [{ name: "Espinacs" }, { name: "Nata" }, { name: "Ceba" }], null);
    expect(s.map((x) => x.id)).toEqual(["a", "c"]);
    expect(s[0]).toMatchObject({ uses: ["Espinacs", "Nata"], missing: 0 });
    expect(s[1].missing).toBe(2);
  });
  it("sense res que caduqui, no proposa res", () => {
    expect(suggestForExpiring([], recipes, [], null)).toEqual([]);
  });
});

describe("plantilles de menú", () => {
  const week = [
    { day: "2026-11-02", meal: "dinar" as const, recipe_id: "r1", note: null, servings: null, recipes: { title: "Llenties" } },
    { day: "2026-11-08", meal: "sopar" as const, recipe_id: null, note: "Pizza", servings: 3 },
    { day: "2026-11-03", meal: "sopar" as const, recipe_id: "r2", note: null, servings: null, status: "proposta" },
  ];
  it("desa la setmana per dia de la setmana, sense les propostes", () => {
    expect(weekToTemplate(week, "2026-11-02")).toEqual([
      { dow: 0, meal: "dinar", recipe_id: "r1", title: "Llenties", note: null, servings: null },
      { dow: 6, meal: "sopar", recipe_id: null, title: null, note: "Pizza", servings: 3 },
    ]);
  });
  it("l'aplica a una altra setmana; si la recepta ja no hi és, queda com a plat sense recepta", () => {
    const t = weekToTemplate(week, "2026-11-02");
    expect(templateToRows(t, "2026-11-30", "h", new Set())).toEqual([
      { household_id: "h", day: "2026-11-30", meal: "dinar", recipe_id: null, note: "Llenties", servings: null },
      { household_id: "h", day: "2026-12-06", meal: "sopar", recipe_id: null, note: "Pizza", servings: 3 },
    ]);
    expect(templateToRows(t, "2026-11-30", "h", new Set(["r1"]))[0]).toMatchObject({ recipe_id: "r1", note: null });
  });
});
