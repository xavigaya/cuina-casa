import { supabaseBrowser } from "./supabase/client";
import { parseIngredientLine } from "./ingredients";
import { formatQuantity } from "./units";
import type { RecipeIngredient, RecipeWithIngredients } from "./types";

export interface RecipeDraft {
  title: string;
  servings: number;
  prep_minutes: number | null;
  image_url: string | null;
  source_url: string | null;
  instructions: string;
  tags: string[];
  ingredientLines: string;
}

export const IMPORT_DRAFT_KEY = "cuina-casa:recepta-importada";

export async function loadRecipe(id: string): Promise<RecipeWithIngredients | null> {
  const { data } = await supabaseBrowser()
    .from("recipes")
    .select("*, recipe_ingredients(*)")
    .eq("id", id)
    .order("position", { referencedTable: "recipe_ingredients" })
    .maybeSingle();
  return (data as RecipeWithIngredients) ?? null;
}

/** "200 g farina" — per editar els ingredients com a text. */
export function ingredientToLine(i: Pick<RecipeIngredient, "name" | "quantity" | "unit" | "optional">): string {
  const qty = i.quantity != null ? formatQuantity(Number(i.quantity), i.unit ?? "u") : "";
  const de = /^[aeiouàèéíòóúh]/i.test(i.name) ? " d'" : " de ";
  const sep = qty && i.unit && i.unit !== "u" ? de : " ";
  const line = qty ? `${qty}${sep}${i.name}` : i.name;
  return i.optional ? `${line} (opcional)` : line;
}

export function ingredientsToLines(list: RecipeIngredient[]): string {
  return [...list].sort((a, b) => a.position - b.position).map(ingredientToLine).join("\n");
}

export async function saveRecipe(
  householdId: string,
  userId: string,
  draft: RecipeDraft,
  existingId?: string,
): Promise<string> {
  const supabase = supabaseBrowser();
  const row = {
    title: draft.title.trim(),
    servings: draft.servings,
    prep_minutes: draft.prep_minutes,
    image_url: draft.image_url?.trim() || null,
    source_url: draft.source_url?.trim() || null,
    instructions: draft.instructions.trim() || null,
    tags: draft.tags,
  };

  let id = existingId;
  if (id) {
    const { error } = await supabase.from("recipes").update(row).eq("id", id);
    if (error) throw error;
    await supabase.from("recipe_ingredients").delete().eq("recipe_id", id);
  } else {
    const { data, error } = await supabase
      .from("recipes")
      .insert({ ...row, household_id: householdId, created_by: userId })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
  }

  const ingredients = draft.ingredientLines
    .split("\n")
    .map(parseIngredientLine)
    .filter((x) => x !== null)
    .map((p, position) => ({
      recipe_id: id,
      position,
      name: p.name,
      quantity: p.quantity,
      unit: p.unit,
      section: p.section,
      optional: p.optional,
    }));
  if (ingredients.length) {
    const { error } = await supabase.from("recipe_ingredients").insert(ingredients);
    if (error) throw error;
  }
  return id!;
}
