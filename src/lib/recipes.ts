import { supabaseBrowser } from "./supabase/client";
import { ingredientKey, parseIngredientLine } from "./ingredients";
import { formatQuantity } from "./units";
import type { Course } from "./courses";
import type { RecipeIngredient, RecipeWithIngredients } from "./types";

export interface RecipeDraft {
  title: string;
  servings: number;
  prep_minutes: number | null;
  image_url: string | null;
  source_url: string | null;
  /** Un pas per línia */
  instructions: string;
  tags: string[];
  course: Course | null;
  is_component: boolean;
  yield_quantity: number | null;
  yield_unit: string | null;
  ingredientLines: string;
  /**
   * Ingredients enllaçats a una altra recepta: clau de l'ingredient → id de la recepta.
   * Una cadena buida vol dir que l'usuari ha tret l'enllaç suggerit.
   */
  links: Record<string, string>;
}

export const IMPORT_DRAFT_KEY = "cuina-casa:recepta-importada";

export function emptyDraft(servings: number): RecipeDraft {
  return {
    title: "",
    servings,
    prep_minutes: null,
    image_url: null,
    source_url: null,
    instructions: "",
    tags: [],
    course: null,
    is_component: false,
    yield_quantity: null,
    yield_unit: null,
    ingredientLines: "",
    links: {},
  };
}

export function draftFromRecipe(r: RecipeWithIngredients): RecipeDraft {
  const links: Record<string, string> = {};
  for (const i of r.recipe_ingredients) {
    links[ingredientKey(i.name)] = i.sub_recipe_id ?? "";
  }
  return {
    title: r.title,
    servings: r.servings,
    prep_minutes: r.prep_minutes,
    image_url: r.image_url,
    source_url: r.source_url,
    instructions: r.instructions ?? "",
    tags: r.tags,
    course: r.course,
    is_component: r.is_component,
    yield_quantity: r.yield_quantity,
    yield_unit: r.yield_unit,
    ingredientLines: ingredientsToLines(r.recipe_ingredients),
    links,
  };
}

export async function loadRecipe(id: string): Promise<RecipeWithIngredients | null> {
  const { data } = await supabaseBrowser()
    .from("recipes")
    .select("*, recipe_ingredients!recipe_ingredients_recipe_id_fkey(*)")
    .eq("id", id)
    .order("position", { referencedTable: "recipe_ingredients" })
    .maybeSingle();
  return (data as RecipeWithIngredients) ?? null;
}

/** Divideix la preparació en passos: un per línia, sense numeració ni línies buides. */
export function splitSteps(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((s) =>
      s
        .replace(/^\s*(?:pas|paso|step)\s*\d+\s*[:.)-]?\s*/i, "")
        .replace(/^\s*\d+\s*[.)º-]\s*/, "")
        .replace(/^\s*[-•*·]\s*/, "")
        .trim(),
    )
    .filter(Boolean);
}

/** "200 g de farina" — per editar els ingredients com a text. */
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

/**
 * Recepta que s'enllaça automàticament amb un ingredient: la que té el mateix nom
 * (primer els preelaborats). L'usuari pot treure o canviar l'enllaç.
 */
export function suggestLink(
  name: string,
  recipes: { id: string; title: string; is_component: boolean }[],
): string | null {
  const key = ingredientKey(name);
  const matches = recipes.filter((r) => ingredientKey(r.title) === key);
  return (matches.find((r) => r.is_component) ?? matches[0])?.id ?? null;
}

/** Enllaç efectiu d'un ingredient: el que ha triat l'usuari o el suggerit. */
export function resolveLink(
  name: string,
  links: Record<string, string>,
  recipes: { id: string; title: string; is_component: boolean }[],
): string | null {
  const key = ingredientKey(name);
  if (key in links) return links[key] || null;
  return suggestLink(name, recipes);
}

export async function saveRecipe(
  householdId: string,
  userId: string,
  draft: RecipeDraft,
  linkable: { id: string; title: string; is_component: boolean }[],
  existingId?: string,
): Promise<string> {
  const supabase = supabaseBrowser();
  const row = {
    title: draft.title.trim(),
    servings: draft.servings,
    prep_minutes: draft.prep_minutes,
    image_url: draft.image_url?.trim() || null,
    source_url: draft.source_url?.trim() || null,
    instructions: splitSteps(draft.instructions).join("\n") || null,
    tags: draft.tags,
    course: draft.course,
    is_component: draft.is_component,
    yield_quantity: draft.is_component ? draft.yield_quantity : null,
    yield_unit: draft.is_component && draft.yield_quantity ? draft.yield_unit : null,
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

  const candidates = linkable.filter((r) => r.id !== id);
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
      sub_recipe_id: resolveLink(p.name, draft.links, candidates),
    }));
  if (ingredients.length) {
    const { error } = await supabase.from("recipe_ingredients").insert(ingredients);
    if (error) throw error;
  }
  return id!;
}
