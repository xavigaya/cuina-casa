import { describe, expect, it } from "vitest";
import { backupFileName, makeBackup, orphanPhotos, parseBackup, photoPathFromUrl, planImport, type BackupPart, type ExistingData } from "./backup";

const backup = makeBackup(
  {
    household: { name: "Casa Gayà" },
    recipes: [
      {
        id: "r-sofregit",
        title: "Sofregit",
        servings: 4,
        is_component: true,
        household_id: "vella",
        created_by: "u",
        recipe_ingredients: [{ id: "i1", recipe_id: "r-sofregit", name: "ceba", position: 0 }],
      },
      {
        id: "r-arros",
        title: "Arròs a la cassola",
        servings: 4,
        recipe_ingredients: [
          { id: "i2", recipe_id: "r-arros", name: "arròs", position: 0 },
          { id: "i3", recipe_id: "r-arros", name: "sofregit", position: 1, sub_recipe_id: "r-sofregit" },
        ],
      },
      { id: "r-truita", title: "Truita", servings: 2, recipe_ingredients: [{ id: "i4", recipe_id: "r-truita", name: "ous" }] },
    ],
    meal_plan: [
      { id: "m1", day: "2026-11-02", meal: "dinar", recipe_id: "r-arros", note: null },
      { id: "m2", day: "2026-11-02", meal: "sopar", recipe_id: "r-truita", note: null },
      { id: "m3", day: "2026-11-03", meal: "sopar", recipe_id: "r-inexistent", note: null },
    ],
    menu_templates: [{ id: "t1", name: "Setmana tipus", entries: [{ dow: 0, meal: "dinar", recipe_id: "r-arros", title: "Arròs a la cassola", note: null }] }],
    pantry_items: [{ id: "p1", name: "Arròs", location: "rebost", quantity: 1, unit: "kg" }],
    shopping_items: [
      { id: "s1", name: "Llet", checked: false },
      { id: "s2", name: "Pa", checked: true },
    ],
    foods: [{ id: "f1", name: "kale", kcal: 49 }],
    product_prices: [{ id: "pp", name: "llet", key: "llet", price: 1.1, quantity: 1, unit: "l" }],
    stores: [{ id: "st", name: "Bonpreu", section_order: ["fruita"] }],
  },
  new Date("2026-11-01T10:00:00Z"),
);

const empty: ExistingData = { recipes: [], meal_plan: [], menu_templates: [], pantry_items: [], shopping_items: [], foods: [], product_prices: [], stores: [] };
const all = new Set<BackupPart>(["receptes", "menu", "plantilles", "rebost", "llista", "aliments", "preus", "supers"]);
let n = 0;
const ids = () => `nou-${++n}`;

describe("còpia de seguretat", () => {
  it("es llegeix de nou i rebutja fitxers que no són còpies", () => {
    expect(typeof parseBackup(JSON.stringify(backup))).toBe("object");
    expect(parseBackup("hola")).toMatch(/no és JSON/);
    expect(parseBackup(JSON.stringify({ app: "una-altra" }))).toMatch(/no és una còpia/);
    expect(parseBackup(JSON.stringify({ ...backup, version: 99 }))).toMatch(/més nova/);
    expect(backupFileName("Casa Gayà", new Date("2026-11-01T10:00:00Z"))).toBe("cuina-casa-casa-gaya-2026-11-01.json");
  });

  it("importa a una llar buida amb ids nous i manté els enllaços", () => {
    n = 0;
    const plan = planImport(backup, empty, all, "llar", ids);
    expect(plan.recipes.map((r) => [r.id, r.title, r.household_id])).toEqual([
      ["nou-1", "Sofregit", "llar"],
      ["nou-2", "Arròs a la cassola", "llar"],
      ["nou-3", "Truita", "llar"],
    ]);
    expect(plan.recipes[0]).not.toHaveProperty("created_by");
    expect(plan.recipe_ingredients.find((i) => i.name === "sofregit")).toMatchObject({ recipe_id: "nou-2", sub_recipe_id: "nou-1" });
    expect(plan.recipe_ingredients.every((i) => !("id" in i))).toBe(true);
    expect(plan.meal_plan.map((m) => m.recipe_id)).toEqual(["nou-2", "nou-3"]); // m3 no té recepta ni nom
    expect((plan.menu_templates[0].entries as { recipe_id: string }[])[0].recipe_id).toBe("nou-2");
    expect(plan.shopping_items.map((s) => s.name)).toEqual(["Llet"]); // el que ja s'havia comprat no
    expect(plan.stores).toHaveLength(1);
    expect(plan.skipped).toBe(1);
  });

  it("no duplica el que ja hi ha i enllaça el menú amb les receptes existents", () => {
    n = 0;
    const existing: ExistingData = {
      ...empty,
      recipes: [{ id: "ja-hi-era", title: "arros a la cassola" }],
      meal_plan: [{ day: "2026-11-02", meal: "dinar", recipe_id: "ja-hi-era", note: null }],
      foods: [{ name: "Kale" }],
      product_prices: [{ key: "llet" }],
    };
    const plan = planImport(backup, existing, all, "llar", ids);
    expect(plan.recipes.map((r) => r.title)).toEqual(["Sofregit", "Truita"]);
    expect(plan.recipe_ingredients.some((i) => i.recipe_id === "ja-hi-era")).toBe(false);
    expect(plan.meal_plan.map((m) => m.recipe_id)).toEqual(["nou-2"]); // el dinar ja hi era
    expect(plan.foods).toHaveLength(0);
    expect(plan.product_prices).toHaveLength(0);
  });

  it("només importa les parts triades; el menú pot apuntar a receptes que ja hi són", () => {
    const plan = planImport(backup, { ...empty, recipes: [{ id: "x", title: "Truita" }] }, new Set<BackupPart>(["menu"]), "llar", ids);
    expect(plan.recipes).toHaveLength(0);
    expect(plan.meal_plan).toEqual([
      expect.objectContaining({ recipe_id: null, note: "Arròs a la cassola" }), // recepta no importada: plat amb el seu nom
      expect.objectContaining({ recipe_id: "x", note: null }),
    ]);
  });
});

describe("fotos òrfenes", () => {
  const bucket = "fotos-receptes";
  const url = (p: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${p}`;
  const now = new Date("2026-11-01T00:00:00Z");
  it("només esborra les que ningú no fa servir i tenen més de 90 dies", () => {
    expect(photoPathFromUrl(url("h/a.webp"), bucket)).toBe("h/a.webp");
    expect(photoPathFromUrl("https://altra.web/foto.jpg", bucket)).toBeNull();
    const files = [
      { path: "h/usada.webp", created_at: "2026-01-01T00:00:00Z", size: 10 },
      { path: "h/al-registre.webp", created_at: "2026-01-01T00:00:00Z", size: 10 },
      { path: "h/nova.webp", created_at: "2026-10-20T00:00:00Z", size: 10 },
      { path: "h/orfe.webp", created_at: "2026-01-01T00:00:00Z", size: 20 },
    ];
    const log = JSON.stringify([{ old_data: { row: { image_url: url("h/al-registre.webp") } } }]);
    expect(orphanPhotos(files, [url("h/usada.webp")], log, bucket, now)).toEqual([{ path: "h/orfe.webp", size: 20 }]);
  });
});
