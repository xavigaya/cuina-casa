import { supabaseBrowser } from "./supabase/client";
import { computeShoppingNeeds, expandPlannedMeals, type NeededItem, type RecipeNode } from "./shopping";
import type { Household, PantryItem, ShoppingItem } from "./types";

/** Carrega totes les receptes de la llar amb els ingredients (incloses les enllaçades). */
async function loadRecipeGraph(householdId: string): Promise<Map<string, RecipeNode>> {
  const { data, error } = await supabaseBrowser()
    .from("recipes")
    .select("id, title, servings, yield_quantity, yield_unit, recipe_ingredients!recipe_ingredients_recipe_id_fkey(name, quantity, unit, section, optional, sub_recipe_id)")
    .eq("household_id", householdId);
  if (error) throw error;
  type Row = Omit<RecipeNode, "ingredients"> & { recipe_ingredients: RecipeNode["ingredients"] };
  return new Map(((data as Row[]) ?? []).map((r) => [r.id, { ...r, ingredients: r.recipe_ingredients ?? [] }]));
}

/**
 * Calcula el que falta per cuinar unes receptes (incloent-hi els preelaborats
 * que no hi ha a casa), resta el rebost i la llista actual, i ho afegeix a la
 * llista de la compra. Torna els productes afegits.
 */
export async function addMissingToShoppingList(
  household: Household,
  userId: string,
  entries: { recipeId: string; servings: number | null }[],
): Promise<NeededItem[]> {
  const supabase = supabaseBrowser();
  const [recipes, { data: pantry }, { data: list }] = await Promise.all([
    loadRecipeGraph(household.id),
    supabase.from("pantry_items").select("name, quantity, unit").eq("household_id", household.id),
    supabase.from("shopping_items").select("name, quantity, unit").eq("household_id", household.id).eq("checked", false),
  ]);

  const stock = (pantry as Pick<PantryItem, "name" | "quantity" | "unit">[]) ?? [];
  const meals = expandPlannedMeals(entries, recipes, stock, household.servings);
  const needs = computeShoppingNeeds(
    meals,
    stock,
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
