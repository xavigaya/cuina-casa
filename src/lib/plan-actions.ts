import { supabaseBrowser } from "./supabase/client";
import { computeShoppingNeeds, type NeededItem, type PlannedMeal } from "./shopping";
import type { Household, PantryItem, ShoppingItem } from "./types";

/**
 * Calcula el que falta per cuinar uns àpats (restant rebost i llista actual)
 * i ho afegeix a la llista de la compra. Torna els productes afegits.
 */
export async function addMissingToShoppingList(
  household: Household,
  userId: string,
  meals: PlannedMeal[],
): Promise<NeededItem[]> {
  const supabase = supabaseBrowser();
  const [{ data: pantry }, { data: list }] = await Promise.all([
    supabase.from("pantry_items").select("name, quantity, unit").eq("household_id", household.id),
    supabase.from("shopping_items").select("name, quantity, unit").eq("household_id", household.id).eq("checked", false),
  ]);

  const needs = computeShoppingNeeds(
    meals,
    (pantry as Pick<PantryItem, "name" | "quantity" | "unit">[]) ?? [],
    (list as Pick<ShoppingItem, "name" | "quantity" | "unit">[]) ?? [],
    household.servings,
  );

  if (needs.length) {
    const { error } = await supabase.from("shopping_items").insert(
      needs.map((n) => ({
        household_id: household.id,
        name: n.name.charAt(0).toUpperCase() + n.name.slice(1),
        quantity: n.quantity,
        unit: n.unit,
        section: n.section,
        note: n.note,
        source: "menu",
        added_by: userId,
      })),
    );
    if (error) throw error;
  }
  return needs;
}
