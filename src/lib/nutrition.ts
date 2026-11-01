/**
 * Càlcul nutricional aproximat de receptes.
 * Valors orientatius a partir d'una taula de referència (BEDCA/USDA); no és consell mèdic.
 */
import { normalizeText, singularize } from "./sections";
import { normalizeUnit, type UnitId } from "./units";

export type HarvardGroup =
  | "verdura" | "fruita" | "patata" | "cereal_integral" | "cereal_refinat" | "llegum" | "peix" | "ou"
  | "aviram" | "carn_vermella" | "carn_processada" | "fruits_secs" | "lactic" | "oli" | "greix"
  | "sucre" | "condiment" | "beguda";

export const HARVARD_GROUPS: { id: HarvardGroup; label: string }[] = [
  { id: "verdura", label: "Verdura" },
  { id: "fruita", label: "Fruita" },
  { id: "patata", label: "Patata (fècula)" },
  { id: "cereal_integral", label: "Cereal integral" },
  { id: "cereal_refinat", label: "Cereal refinat" },
  { id: "llegum", label: "Llegums" },
  { id: "peix", label: "Peix i marisc" },
  { id: "ou", label: "Ous" },
  { id: "aviram", label: "Aviram i conill" },
  { id: "carn_vermella", label: "Carn vermella" },
  { id: "carn_processada", label: "Carn processada" },
  { id: "fruits_secs", label: "Fruits secs i llavors" },
  { id: "lactic", label: "Làctics" },
  { id: "oli", label: "Oli i greixos saludables" },
  { id: "greix", label: "Mantega, nata i salses" },
  { id: "sucre", label: "Dolços i sucre" },
  { id: "condiment", label: "Condiments i brous" },
  { id: "beguda", label: "Begudes" },
];

export interface Food {
  id: string;
  household_id: string | null;
  name: string;
  aliases: string[];
  kcal: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  harvard_group: HarvardGroup;
  unit_g: number | null;
  pack_g: number | null;
  density: number;
  plate_factor: number;
  source?: string;
  barcode?: string | null;
}

export interface Nutrients {
  kcal: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
}

export type PlateGrams = Partial<Record<HarvardGroup, number>>;

export interface MissingIngredient {
  name: string;
  reason: "sense_dades" | "sense_pes";
  /** Recepta on és l'ingredient, si és dins d'un preelaborat */
  in?: string;
}

export interface NutritionResult {
  servings: number;
  total: Nutrients;
  perServing: Nutrients;
  /** Grams «al plat» per ració, per grups (amb el factor de cocció aplicat) */
  plate: PlateGrams;
  /** Pes cru total de la recepta en grams */
  totalGrams: number;
  missing: MissingIngredient[];
  /** Hi ha ingredients sense dades: el resultat és incomplet */
  incomplete: boolean;
}

export const ZERO: Nutrients = { kcal: 0, carbs: 0, protein: 0, fat: 0, fiber: 0 };

export function addNutrients(a: Nutrients, b: Nutrients, factor = 1): Nutrients {
  return {
    kcal: a.kcal + b.kcal * factor,
    carbs: a.carbs + b.carbs * factor,
    protein: a.protein + b.protein * factor,
    fat: a.fat + b.fat * factor,
    fiber: a.fiber + b.fiber * factor,
  };
}

export function scaleNutrients(a: Nutrients, factor: number): Nutrients {
  return addNutrients(ZERO, a, factor);
}

export function addPlate(a: PlateGrams, b: PlateGrams, factor = 1): PlateGrams {
  const out: PlateGrams = { ...a };
  for (const [k, v] of Object.entries(b) as [HarvardGroup, number][]) {
    out[k] = (out[k] ?? 0) + v * factor;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cerca d'aliments per nom
// ---------------------------------------------------------------------------

const FILLER = /\b(fresc|fresca|frescos|fresques|fresco|fresca|madur|madura|petit|petita|gran|grans|mitja|mitjana|bo|bona|de qualitat|picat|picada|tallat|tallada|a daus|en daus|a trossos|trossejat|bullit|bullida|pelat|pelada|sense pell|sin piel|picado|picada|troceado|natural|ecologic|ecologica|bio)\b/g;

/** Clau per comparar noms d'aliments: minúscules, sense accents, en singular. */
export function foodKey(name: string): string {
  return normalizeText(name)
    .replace(/\(.*?\)/g, " ")
    .replace(/,.*$/, "")
    .replace(/[^a-z0-9' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(singularize)
    .join(" ");
}

export interface FoodIndex {
  byKey: Map<string, Food>;
  keys: string[]; // ordenades de més llarga a més curta
}

/** Índex d'aliments. Els aliments propis de la llar substitueixen els de referència. */
export function buildFoodIndex(foods: Food[]): FoodIndex {
  const byKey = new Map<string, Food>();
  const ordered = [...foods].sort((a, b) => Number(a.household_id != null) - Number(b.household_id != null));
  for (const food of ordered) {
    for (const n of [food.name, ...(food.aliases ?? [])]) {
      const k = foodKey(n);
      if (k) byKey.set(k, food);
    }
  }
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  return { byKey, keys };
}

/**
 * Troba l'aliment d'un ingredient: primer pel nom exacte i, si no, per l'aliment
 * més llarg que hi aparegui com a paraules senceres («oli d'oliva verge extra» → «oli d'oliva»).
 */
export function matchFood(index: FoodIndex, name: string): Food | null {
  const key = foodKey(name);
  if (!key) return null;
  const exact = index.byKey.get(key);
  if (exact) return exact;
  const cleaned = key.replace(FILLER, " ").replace(/\s+/g, " ").trim();
  const exactClean = index.byKey.get(cleaned);
  if (exactClean) return exactClean;
  const hay = ` ${cleaned} `;
  for (const k of index.keys) {
    if (k.length >= 2 && hay.includes(` ${k} `)) return index.byKey.get(k)!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Conversió a grams
// ---------------------------------------------------------------------------

const ML_PER_UNIT: Partial<Record<UnitId, number>> = {
  ml: 1, cl: 10, dl: 100, l: 1000,
  cullerada: 15, culleradeta: 5, tassa: 240, got: 200,
};

const DEFAULT_PACK_G: Partial<Record<UnitId, number>> = { llauna: 400, pot: 400, paquet: 500, manat: 100 };

/**
 * Converteix una quantitat a grams.
 *  - null → la quantitat és vaga («sal al gust»): compta com a zero
 *  - undefined (dins l'objecte) → no se sap el pes (p. ex. «2 unitats» d'un aliment sense pes per unitat)
 */
export function toGrams(
  quantity: number | null | undefined,
  unit: string | null | undefined,
  food: Pick<Food, "unit_g" | "pack_g" | "density"> | null,
): { grams: number | null; vague: boolean } {
  if (quantity == null || !Number.isFinite(Number(quantity))) return { grams: 0, vague: true };
  const q = Number(quantity);
  const u = normalizeUnit(unit) ?? (unit ? null : "u");
  const density = food?.density && food.density > 0 ? Number(food.density) : 1;

  if (u === "g") return { grams: q, vague: false };
  if (u === "kg") return { grams: q * 1000, vague: false };
  if (u && ML_PER_UNIT[u] != null) return { grams: q * ML_PER_UNIT[u]! * density, vague: false };
  switch (u) {
    case "pessic":
      return { grams: q * 0.5, vague: false };
    case "gra":
      return { grams: q * (food?.unit_g && food.unit_g <= 15 ? Number(food.unit_g) : 5), vague: false };
    case "llesca":
      return { grams: q * (food?.unit_g && food.unit_g <= 60 ? Number(food.unit_g) : 30), vague: false };
    case "llauna":
    case "pot":
    case "paquet":
    case "manat":
      return { grams: q * (food?.pack_g ? Number(food.pack_g) : DEFAULT_PACK_G[u]!), vague: false };
    case "u":
      return { grams: food?.unit_g ? q * Number(food.unit_g) : null, vague: false };
    default:
      return { grams: null, vague: false };
  }
}

// ---------------------------------------------------------------------------
// Càlcul de receptes (amb preelaborats recursius)
// ---------------------------------------------------------------------------

export interface NutritionRecipe {
  id: string;
  title: string;
  servings: number;
  yield_quantity?: number | null;
  yield_unit?: string | null;
  ingredients: {
    name: string;
    quantity: number | null;
    unit: string | null;
    optional?: boolean;
    sub_recipe_id?: string | null;
  }[];
}

const MAX_DEPTH = 4;

/**
 * Crea una calculadora amb memòria: cada recepta es calcula una sola vegada
 * encara que aparegui com a preelaborat en moltes altres.
 */
export function createNutritionCalculator(recipes: Map<string, NutritionRecipe>, index: FoodIndex) {
  const memo = new Map<string, NutritionResult>();

  const compute = (recipe: NutritionRecipe, depth: number, seen: Set<string>): NutritionResult => {
    const cached = memo.get(recipe.id);
    if (cached) return cached;

    const servings = recipe.servings > 0 ? recipe.servings : 1;
    let total = ZERO;
    let plateTotal: PlateGrams = {};
    let totalGrams = 0;
    const missing: MissingIngredient[] = [];

    for (const ing of recipe.ingredients) {
      if (ing.optional || !ing.name?.trim()) continue;

      const sub = ing.sub_recipe_id ? recipes.get(ing.sub_recipe_id) : undefined;
      if (sub && !seen.has(sub.id) && depth < MAX_DEPTH) {
        const subRes = compute(sub, depth + 1, new Set([...seen, sub.id]));
        const fraction = subRecipeFraction(ing, sub, subRes, servings);
        if (fraction > 0) {
          total = addNutrients(total, subRes.total, fraction);
          plateTotal = addPlate(plateTotal, scalePlate(subRes.plate, subRes.servings), fraction);
          totalGrams += subRes.totalGrams * fraction;
        }
        for (const m of subRes.missing) missing.push({ ...m, in: m.in ?? sub.title });
        continue;
      }

      const food = matchFood(index, ing.name);
      if (!food) {
        if (ing.quantity != null) missing.push({ name: ing.name, reason: "sense_dades" });
        continue;
      }
      const { grams } = toGrams(ing.quantity, ing.unit, food);
      if (grams == null) {
        missing.push({ name: ing.name, reason: "sense_pes" });
        continue;
      }
      if (grams === 0) continue;
      total = addNutrients(total, food, grams / 100);
      plateTotal = addPlate(plateTotal, { [food.harvard_group]: grams * (Number(food.plate_factor) || 1) });
      totalGrams += grams;
    }

    const result: NutritionResult = {
      servings,
      total,
      perServing: scaleNutrients(total, 1 / servings),
      plate: scalePlate(plateTotal, 1 / servings),
      totalGrams,
      missing,
      incomplete: missing.length > 0,
    };
    memo.set(recipe.id, result);
    return result;
  };

  return {
    /** Valors d'una recepta pel seu id (null si no existeix). */
    byId(id: string): NutritionResult | null {
      const r = recipes.get(id);
      return r ? compute(r, 0, new Set([r.id])) : null;
    },
    compute(recipe: NutritionRecipe): NutritionResult {
      return compute(recipe, 0, new Set([recipe.id]));
    },
  };
}

function scalePlate(p: PlateGrams, factor: number): PlateGrams {
  return addPlate({}, p, factor);
}

/**
 * Quina part del preelaborat entra a la recepta:
 *  - si es demana una quantitat en pes o volum, es compara amb el que en surt
 *    (el rendiment indicat o, si no n'hi ha, el pes cru dels seus ingredients);
 *  - si no, se suposa que es fa per al mateix nombre de persones que el plat.
 */
function subRecipeFraction(
  ing: NutritionRecipe["ingredients"][number],
  sub: NutritionRecipe,
  subRes: NutritionResult,
  parentServings: number,
): number {
  const unit = normalizeUnit(ing.unit);
  const weighable = unit && unit !== "u" && unit !== "pessic";
  if (ing.quantity != null && weighable) {
    const wanted = toGrams(ing.quantity, unit, null).grams;
    const yieldG = sub.yield_quantity ? toGrams(sub.yield_quantity, sub.yield_unit, null).grams : null;
    const base = yieldG && yieldG > 0 ? yieldG : subRes.totalGrams;
    if (wanted != null && base > 0) return wanted / base;
  }
  const subServings = sub.servings > 0 ? sub.servings : 1;
  return parentServings / subServings;
}

export function roundNutrients(n: Nutrients): Nutrients {
  return {
    kcal: Math.round(n.kcal),
    carbs: Math.round(n.carbs),
    protein: Math.round(n.protein),
    fat: Math.round(n.fat),
    fiber: Math.round(n.fiber),
  };
}
