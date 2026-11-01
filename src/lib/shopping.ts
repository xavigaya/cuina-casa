import { ingredientKey } from "./ingredients";
import { guessSection } from "./sections";
import { formatQuantity, fromBase, normalizeUnit, roundQuantity, toBase, type UnitId } from "./units";

export interface PlannedMeal {
  servings: number | null;
  recipe: {
    title: string;
    servings: number;
    ingredients: {
      name: string;
      quantity: number | null;
      unit: string | null;
      section?: string | null;
      optional?: boolean;
    }[];
  };
}

export interface StockItem {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface NeededItem {
  name: string;
  quantity: number | null;
  unit: UnitId | null;
  section: string;
  note: string | null;
}

interface Need {
  name: string;
  key: string;
  quantity: number | null; // en unitat base; null = "una mica" (sense quantitat)
  unit: UnitId | null;
  section: string;
  recipes: Set<string>;
}

/**
 * Calcula què cal comprar per cuinar els àpats planificats:
 *  1. suma els ingredients de totes les receptes, escalats a les racions de cada àpat
 *  2. resta el que ja hi ha al rebost
 *  3. resta el que ja és a la llista de la compra (sense marcar)
 */
export function computeShoppingNeeds(
  meals: PlannedMeal[],
  pantry: StockItem[],
  existingList: StockItem[],
  defaultServings: number,
): NeededItem[] {
  const needs = new Map<string, Need>();

  for (const meal of meals) {
    const recipeServings = meal.recipe.servings > 0 ? meal.recipe.servings : defaultServings;
    const factor = (meal.servings ?? defaultServings) / recipeServings;

    for (const ing of meal.recipe.ingredients) {
      if (ing.optional || !ing.name.trim()) continue;
      const key = ingredientKey(ing.name);
      const unit = normalizeUnit(ing.unit);
      const base =
        ing.quantity != null ? toBase(Number(ing.quantity) * factor, unit) : { quantity: null, unit };
      const mapKey = `${key}|${base.quantity == null ? "?" : base.unit ?? "u"}`;

      const existing = needs.get(mapKey);
      if (existing) {
        if (existing.quantity != null && base.quantity != null) existing.quantity += base.quantity;
        existing.recipes.add(meal.recipe.title);
      } else {
        needs.set(mapKey, {
          name: ing.name.trim(),
          key,
          quantity: base.quantity,
          unit: base.unit,
          section: ing.section && ing.section !== "altres" ? ing.section : guessSection(ing.name),
          recipes: new Set([meal.recipe.title]),
        });
      }
    }
  }

  // Si un mateix ingredient apareix amb i sense quantitat, ens quedem amb la versió amb quantitat
  for (const [mapKey, need] of needs) {
    if (need.quantity == null) {
      const withQty = [...needs.values()].some((n) => n !== need && n.key === need.key && n.quantity != null);
      if (withQty) needs.delete(mapKey);
    }
  }

  const pantryByKey = groupStock(pantry);
  const listByKey = groupStock(existingList);
  const result: NeededItem[] = [];

  for (const need of needs.values()) {
    const notes: string[] = [];
    let remaining = need.quantity;

    for (const [source, label] of [[pantryByKey, "a casa"], [listByKey, "ja a la llista"]] as const) {
      const stock = source.get(need.key);
      if (!stock || remaining === 0) continue;

      if (remaining == null) {
        remaining = 0; // en tenim i no cal quantitat concreta
        continue;
      }

      let incomparable = false;
      for (const s of stock) {
        if (s.quantity == null) {
          // En tenim però no sabem quant: ho donem per cobert
          remaining = 0;
          break;
        }
        if ((s.unit ?? "u") === (need.unit ?? "u")) {
          remaining = Math.max(0, remaining - s.quantity);
        } else {
          incomparable = true;
          notes.push(`${label}: ${formatQuantity(roundQuantity(s.quantity, s.unit), s.unit)}`);
        }
      }
      if (incomparable && remaining === 0) notes.length = 0;
    }

    if (remaining === 0) continue;

    const pretty = remaining == null ? { quantity: null, unit: need.unit } : fromBase(remaining, need.unit);
    const recipeNote = `Per a: ${[...need.recipes].join(", ")}`;
    result.push({
      name: need.name,
      quantity: pretty.quantity == null ? null : roundQuantity(pretty.quantity, pretty.unit),
      unit: pretty.quantity == null ? null : pretty.unit,
      section: need.section,
      note: [recipeNote, ...notes].join(" · "),
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, "ca"));
}

function groupStock(items: StockItem[]) {
  const map = new Map<string, { quantity: number | null; unit: UnitId | null }[]>();
  for (const item of items) {
    const key = ingredientKey(item.name);
    const unit = normalizeUnit(item.unit);
    const base =
      item.quantity != null ? toBase(Number(item.quantity), unit) : { quantity: null, unit };
    const arr = map.get(key) ?? [];
    arr.push(base);
    map.set(key, arr);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Receptes enllaçades (preelaborats)
// ---------------------------------------------------------------------------

export interface RecipeNode {
  id: string;
  title: string;
  servings: number;
  yield_quantity: number | null;
  yield_unit: string | null;
  ingredients: {
    name: string;
    quantity: number | null;
    unit: string | null;
    section?: string | null;
    optional?: boolean;
    sub_recipe_id?: string | null;
  }[];
}

const MAX_DEPTH = 4;

/**
 * Converteix els àpats planificats en una llista plana de receptes a cuinar.
 * Quan un ingredient és una altra recepta (un preelaborat com un sofregit):
 *  - si ja n'hi ha prou al rebost, no cal fer res;
 *  - si no, s'hi afegeix la recepta del preelaborat, escalada a la quantitat que falta.
 *
 * Com s'escala el preelaborat:
 *  - si la recepta indica quant en surt (p. ex. 500 g) i les unitats són compatibles,
 *    es fa la part proporcional (200 g → 0,4 vegades la recepta);
 *  - si no, se suposa que es fa per al mateix nombre de persones que el plat.
 */
export function expandPlannedMeals(
  entries: { recipeId: string; servings: number | null }[],
  recipes: Map<string, RecipeNode>,
  pantry: StockItem[],
  defaultServings: number,
): PlannedMeal[] {
  const result: PlannedMeal[] = [];
  const stock = groupStock(pantry);

  const walk = (recipe: RecipeNode, portions: number, depth: number, seen: Set<string>) => {
    const recipeServings = recipe.servings > 0 ? recipe.servings : defaultServings;
    const factor = portions / recipeServings;
    const plain: RecipeNode["ingredients"] = [];

    for (const ing of recipe.ingredients) {
      const sub = ing.sub_recipe_id ? recipes.get(ing.sub_recipe_id) : undefined;
      if (!sub || ing.optional || seen.has(sub.id) || depth >= MAX_DEPTH) {
        plain.push(ing);
        continue;
      }

      const unit = normalizeUnit(ing.unit);
      const needed = ing.quantity != null ? toBase(Number(ing.quantity) * factor, unit) : null;
      const remaining = consumeStock(stock, [ingredientKey(ing.name), ingredientKey(sub.title)], needed);
      if (remaining === 0) continue; // ja en tenim a casa

      let subPortions = portions; // per defecte, per a les mateixes persones que el plat
      if (remaining != null && sub.yield_quantity) {
        const yieldBase = toBase(Number(sub.yield_quantity), normalizeUnit(sub.yield_unit));
        if ((yieldBase.unit ?? "u") === (remaining.unit ?? "u") && yieldBase.quantity > 0) {
          subPortions = (remaining.quantity / yieldBase.quantity) * (sub.servings > 0 ? sub.servings : defaultServings);
        }
      }
      walk(sub, subPortions, depth + 1, new Set([...seen, sub.id]));
    }

    if (plain.length) {
      result.push({ servings: portions, recipe: { title: recipe.title, servings: recipeServings, ingredients: plain } });
    }
  };

  for (const entry of entries) {
    const recipe = recipes.get(entry.recipeId);
    if (recipe) walk(recipe, entry.servings ?? defaultServings, 0, new Set([recipe.id]));
  }
  return result;
}

/**
 * Resta del rebost la quantitat necessària d'un preelaborat.
 * Torna el que falta (null = en falta però no sabem quant; 0 = cobert).
 */
function consumeStock(
  stock: Map<string, { quantity: number | null; unit: UnitId | null }[]>,
  keys: string[],
  needed: { quantity: number; unit: UnitId | null } | null,
): { quantity: number; unit: UnitId | null } | 0 | null {
  const items = keys.flatMap((k) => stock.get(k) ?? []);
  if (items.length === 0) return needed;
  let remaining = needed ? { ...needed } : null;
  for (const item of items) {
    if (item.quantity == null || item.quantity <= 0) {
      if (item.quantity == null) return 0; // en tenim, sense quantitat concreta
      continue;
    }
    if (!remaining) {
      item.quantity = 0;
      return 0;
    }
    if ((item.unit ?? "u") !== (remaining.unit ?? "u")) return 0; // unitats diferents: en tenim, ho donem per bo
    const used = Math.min(item.quantity, remaining.quantity);
    item.quantity -= used;
    remaining.quantity -= used;
    if (remaining.quantity <= 1e-9) return 0;
  }
  return remaining;
}
