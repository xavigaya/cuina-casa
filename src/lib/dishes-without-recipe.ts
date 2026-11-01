import { supabaseBrowser } from "./supabase/client";
import { normalizeText } from "./sections";

/** Plat afegit al menú només amb un nom (sense recepta). */
export interface DishWithoutRecipe {
  name: string;
  key: string;
  entryIds: string[];
  /** Vegades que surt al menú */
  count: number;
  /** Primer dia (d'avui endavant) en què surt al menú, o l'últim si ja ha passat */
  day: string;
}

export function dishKey(name: string): string {
  return normalizeText(name).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Agrupa per nom (sense distingir majúscules ni accents) les entrades del menú sense recepta. */
export function groupDishes(entries: { id: string; note: string | null; day: string }[], todayISO: string): DishWithoutRecipe[] {
  const map = new Map<string, DishWithoutRecipe>();
  for (const e of entries) {
    const name = e.note?.trim();
    if (!name) continue;
    const key = dishKey(name);
    if (!key) continue;
    const g = map.get(key);
    if (g) {
      g.entryIds.push(e.id);
      g.count++;
      // Ens quedem amb el dia futur més proper; si no n'hi ha, amb el més recent
      const better = e.day >= todayISO ? g.day < todayISO || e.day < g.day : g.day < todayISO && e.day > g.day;
      if (better) g.day = e.day;
    } else {
      map.set(key, { name, key, entryIds: [e.id], count: 1, day: e.day });
    }
  }
  // Primer els que vénen aviat, després els passats
  return [...map.values()].sort((a, b) => {
    const fa = a.day >= todayISO;
    const fb = b.day >= todayISO;
    if (fa !== fb) return fa ? -1 : 1;
    return fa ? a.day.localeCompare(b.day) : b.day.localeCompare(a.day);
  });
}

export async function loadDishesWithoutRecipe(householdId: string, todayISO: string): Promise<DishWithoutRecipe[]> {
  const { data } = await supabaseBrowser()
    .from("meal_plan")
    .select("id, note, day")
    .eq("household_id", householdId)
    .is("recipe_id", null)
    .not("note", "is", null);
  return groupDishes((data as { id: string; note: string | null; day: string }[]) ?? [], todayISO);
}

/** Enllaça amb una recepta totes les entrades del menú d'un plat sense recepta. */
export async function linkDishToRecipe(householdId: string, dishName: string, recipeId: string): Promise<number> {
  const supabase = supabaseBrowser();
  const { data } = await supabase.from("meal_plan").select("id, note").eq("household_id", householdId).is("recipe_id", null);
  const key = dishKey(dishName);
  const ids = ((data as { id: string; note: string | null }[]) ?? []).filter((e) => e.note && dishKey(e.note) === key).map((e) => e.id);
  if (!ids.length) return 0;
  const { error } = await supabase.from("meal_plan").update({ recipe_id: recipeId, note: null }).in("id", ids);
  if (error) throw error;
  return ids.length;
}
