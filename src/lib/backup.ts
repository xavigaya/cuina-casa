/**
 * Còpia de seguretat de la llar en un fitxer JSON, i importació sense
 * duplicats (amb ids nous, de manera que es pot importar a la mateixa llar o
 * a una altra). També la neteja de fotos que ja no fa servir ningú.
 */
import { normalizeText } from "./sections";

export const BACKUP_APP = "cuina-casa";
export const BACKUP_VERSION = 1;

type Row = Record<string, unknown>;

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exported_at: string;
  household: { name: string; servings?: number; expiry_warning_days?: number };
  recipes: (Row & { recipe_ingredients?: Row[] })[];
  meal_plan: Row[];
  menu_templates: Row[];
  pantry_items: Row[];
  shopping_items: Row[];
  foods: Row[];
  product_prices: Row[];
  stores: Row[];
}

export type BackupPart = "receptes" | "menu" | "plantilles" | "rebost" | "llista" | "aliments" | "preus" | "supers";

export const PART_LABEL: Record<BackupPart, string> = {
  receptes: "Receptes",
  menu: "Menú",
  plantilles: "Plantilles de menú",
  rebost: "Rebost",
  llista: "Llista de la compra",
  aliments: "Aliments propis",
  preus: "Preus",
  supers: "Supermercats",
};

/** Columnes que es copien de cada taula (així una còpia d'una versió més nova no trenca res) */
const COLUMNS = {
  recipes: ["title", "servings", "prep_minutes", "instructions", "source_url", "image_url", "tags", "course", "is_component", "yield_quantity", "yield_unit", "status"],
  recipe_ingredients: ["position", "name", "quantity", "unit", "section", "optional"],
  meal_plan: ["day", "meal", "note", "servings", "status"],
  menu_templates: ["name", "entries"],
  pantry_items: ["name", "quantity", "unit", "location", "section", "expires_on", "barcode", "min_quantity"],
  shopping_items: ["name", "quantity", "unit", "section", "note", "checked", "source"],
  foods: ["name", "aliases", "kcal", "carbs", "protein", "fat", "fiber", "harvard_group", "unit_g", "pack_g", "density", "plate_factor", "barcode", "source"],
  product_prices: ["name", "key", "price", "quantity", "unit"],
  stores: ["name", "section_order"],
} as const;

function pick(row: Row, cols: readonly string[]): Row {
  const out: Row = {};
  for (const c of cols) if (row[c] !== undefined) out[c] = row[c];
  return out;
}

export function makeBackup(data: Omit<Backup, "app" | "version" | "exported_at">, now = new Date()): Backup {
  return { app: BACKUP_APP, version: BACKUP_VERSION, exported_at: now.toISOString(), ...data };
}

export function backupFileName(householdName: string, now = new Date()): string {
  const slug = normalizeText(householdName).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "llar";
  return `cuina-casa-${slug}-${now.toISOString().slice(0, 10)}.json`;
}

/** Llegeix i valida un fitxer de còpia. Torna un missatge d'error si no ho és. */
export function parseBackup(text: string): Backup | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "El fitxer no és una còpia de Cuina Casa (no és JSON).";
  }
  const b = raw as Partial<Backup>;
  if (!b || b.app !== BACKUP_APP || typeof b.version !== "number") return "El fitxer no és una còpia de Cuina Casa.";
  if (b.version > BACKUP_VERSION) return "Aquesta còpia és d'una versió més nova de l'app: actualitza la pàgina i torna-ho a provar.";
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Row[]) : []);
  return {
    app: BACKUP_APP,
    version: b.version,
    exported_at: String(b.exported_at ?? ""),
    household: { name: String(b.household?.name ?? "Llar"), servings: b.household?.servings, expiry_warning_days: b.household?.expiry_warning_days },
    recipes: arr(b.recipes) as Backup["recipes"],
    meal_plan: arr(b.meal_plan),
    menu_templates: arr(b.menu_templates),
    pantry_items: arr(b.pantry_items),
    shopping_items: arr(b.shopping_items),
    foods: arr(b.foods),
    product_prices: arr(b.product_prices),
    stores: arr(b.stores),
  };
}

export function backupCounts(b: Backup): Record<BackupPart, number> {
  return {
    receptes: b.recipes.length,
    menu: b.meal_plan.length,
    plantilles: b.menu_templates.length,
    rebost: b.pantry_items.length,
    llista: b.shopping_items.length,
    aliments: b.foods.length,
    preus: b.product_prices.length,
    supers: b.stores.length,
  };
}

/** El que ja hi ha a la llar on s'importa, per no duplicar res */
export interface ExistingData {
  recipes: { id: string; title: string }[];
  meal_plan: { day: string; meal: string; recipe_id: string | null; note: string | null }[];
  menu_templates: { name: string }[];
  pantry_items: { name: string; location: string; expires_on: string | null }[];
  shopping_items: { name: string; checked: boolean }[];
  foods: { name: string }[];
  product_prices: { key: string }[];
  stores: { name: string }[];
}

export interface ImportPlan {
  recipes: Row[];
  recipe_ingredients: Row[];
  meal_plan: Row[];
  menu_templates: Row[];
  pantry_items: Row[];
  shopping_items: Row[];
  foods: Row[];
  product_prices: Row[];
  stores: Row[];
  /** elements que ja hi eren i no s'importen */
  skipped: number;
}

const key = (s: unknown) => normalizeText(String(s ?? "")).trim();

/**
 * Prepara què s'ha d'inserir. Les receptes que ja existeixen (mateix títol)
 * no es dupliquen, però el menú i les plantilles s'hi enllacen igualment.
 */
export function planImport(
  backup: Backup,
  existing: ExistingData,
  parts: Set<BackupPart>,
  householdId: string,
  newId: () => string = () => crypto.randomUUID(),
): ImportPlan {
  const plan: ImportPlan = { recipes: [], recipe_ingredients: [], meal_plan: [], menu_templates: [], pantry_items: [], shopping_items: [], foods: [], product_prices: [], stores: [], skipped: 0 };
  const byTitle = new Map(existing.recipes.map((r) => [key(r.title), r.id]));
  const idMap = new Map<string, string>(); // id antic → id a la llar
  const created = new Set<string>();

  // Receptes: primer els ids, perquè els preelaborats es puguin enllaçar entre ells
  for (const r of backup.recipes) {
    const oldId = String(r.id ?? "");
    const same = byTitle.get(key(r.title));
    if (same) {
      idMap.set(oldId, same);
      if (parts.has("receptes")) plan.skipped++;
    } else if (parts.has("receptes")) {
      const id = newId();
      idMap.set(oldId, id);
      created.add(id);
      byTitle.set(key(r.title), id);
    }
  }
  if (parts.has("receptes")) {
    for (const r of backup.recipes) {
      const id = idMap.get(String(r.id ?? ""));
      if (!id || !created.has(id)) continue;
      plan.recipes.push({ ...pick(r, COLUMNS.recipes), id, household_id: householdId });
      for (const ing of r.recipe_ingredients ?? []) {
        const sub = ing.sub_recipe_id ? idMap.get(String(ing.sub_recipe_id)) ?? null : null;
        plan.recipe_ingredients.push({ ...pick(ing, COLUMNS.recipe_ingredients), recipe_id: id, sub_recipe_id: sub === id ? null : sub });
      }
    }
  }

  const recipeTitle = new Map(backup.recipes.map((r) => [String(r.id ?? ""), String(r.title ?? "")]));

  if (parts.has("menu")) {
    const seen = new Set(existing.meal_plan.map((m) => `${m.day}|${m.meal}|${m.recipe_id ?? ""}|${key(m.note)}`));
    for (const m of backup.meal_plan) {
      const oldRecipe = m.recipe_id ? String(m.recipe_id) : null;
      const recipe_id = oldRecipe ? idMap.get(oldRecipe) ?? null : null;
      const note = recipe_id ? null : ((m.note as string | null) ?? (oldRecipe ? recipeTitle.get(oldRecipe) ?? null : null));
      const k = `${m.day}|${m.meal}|${recipe_id ?? ""}|${key(note)}`;
      if (seen.has(k) || (!recipe_id && !note)) {
        plan.skipped++;
        continue;
      }
      seen.add(k);
      plan.meal_plan.push({ ...pick(m, COLUMNS.meal_plan), recipe_id, note, household_id: householdId });
    }
  }

  if (parts.has("plantilles")) {
    const names = new Set(existing.menu_templates.map((t) => key(t.name)));
    for (const t of backup.menu_templates) {
      if (names.has(key(t.name))) {
        plan.skipped++;
        continue;
      }
      names.add(key(t.name));
      const entries = (Array.isArray(t.entries) ? (t.entries as Row[]) : []).map((e) => {
        const rid = e.recipe_id ? idMap.get(String(e.recipe_id)) ?? null : null;
        return { ...e, recipe_id: rid, note: rid ? e.note ?? null : (e.note ?? e.title ?? null) };
      });
      plan.menu_templates.push({ ...pick(t, COLUMNS.menu_templates), entries, household_id: householdId });
    }
  }

  const simple = <T extends keyof typeof COLUMNS>(
    part: BackupPart,
    table: T & keyof ImportPlan,
    rows: Row[],
    keyOf: (r: Row) => string,
    existingKeys: string[],
  ) => {
    if (!parts.has(part)) return;
    const seen = new Set(existingKeys);
    for (const r of rows) {
      const k = keyOf(r);
      if (seen.has(k)) {
        plan.skipped++;
        continue;
      }
      seen.add(k);
      (plan[table] as Row[]).push({ ...pick(r, COLUMNS[table]), household_id: householdId });
    }
  };

  simple("rebost", "pantry_items", backup.pantry_items, (r) => `${key(r.name)}|${r.location}|${r.expires_on ?? ""}`, existing.pantry_items.map((p) => `${key(p.name)}|${p.location}|${p.expires_on ?? ""}`));
  simple(
    "llista",
    "shopping_items",
    backup.shopping_items.filter((s) => !s.checked),
    (r) => key(r.name),
    existing.shopping_items.filter((s) => !s.checked).map((s) => key(s.name)),
  );
  simple("aliments", "foods", backup.foods, (r) => key(r.name), existing.foods.map((f) => key(f.name)));
  simple("preus", "product_prices", backup.product_prices, (r) => String(r.key ?? ""), existing.product_prices.map((p) => p.key));
  simple("supers", "stores", backup.stores, (r) => key(r.name), existing.stores.map((s) => key(s.name)));

  // La llista s'importa sense marcar i com a feta a mà
  plan.shopping_items = plan.shopping_items.map((s) => ({ ...s, checked: false }));
  return plan;
}

// ---------------------------------------------------------------------------
// Fotos que ja no fa servir ningú
// ---------------------------------------------------------------------------

export const PHOTO_KEEP_DAYS = 90;

/** Camí dins del magatzem a partir de l'adreça pública d'una foto */
export function photoPathFromUrl(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const i = url.indexOf(marker);
  return i < 0 ? null : decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

/**
 * Fotos que es poden esborrar: cap recepta no les fa servir, no surten al
 * registre (que es pot desfer durant 90 dies) i fa més de 90 dies que es van pujar.
 */
export function orphanPhotos(
  files: { path: string; created_at: string | null; size?: number }[],
  usedUrls: string[],
  logText: string,
  bucket: string,
  now = new Date(),
): { path: string; size: number }[] {
  const used = new Set(usedUrls.map((u) => photoPathFromUrl(u, bucket)).filter(Boolean) as string[]);
  const limit = now.getTime() - PHOTO_KEEP_DAYS * 86400000;
  return files
    .filter((f) => !used.has(f.path))
    .filter((f) => !logText.includes(f.path) && !logText.includes(encodeURI(f.path)))
    .filter((f) => f.created_at && Date.parse(f.created_at) < limit)
    .map((f) => ({ path: f.path, size: f.size ?? 0 }));
}
