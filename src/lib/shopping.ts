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
