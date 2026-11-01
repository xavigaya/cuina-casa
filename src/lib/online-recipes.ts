import type { ImportedRecipe } from "./recipe-import";
import type { Nutrients, PlateGrams } from "./nutrition";
import type { Course } from "./courses";
import { emptyDraft, ingredientToLine, saveRecipe } from "./recipes";

/** Recepta trobada a Internet, ja valorada segons el Plat de Harvard. */
export interface OnlineRecipe {
  url: string;
  site: string;
  title: string;
  image: string | null;
  servings: number | null;
  prepMinutes: number | null;
  course: Course | null;
  perServing: Nutrients | null;
  plate: PlateGrams | null;
  evaluation: { score: number; status: string; advice: string[] } | null;
  incomplete: boolean;
  /** Què aporta per compensar el desequilibri que s'ha buscat */
  compensates: string[];
  /** S'ha traduït automàticament del castellà */
  translated: boolean;
  recipe: ImportedRecipe;
}

/** Desa a les receptes de la llar una recepta trobada a Internet. Torna l'id nou. */
export async function importOnlineRecipe(householdId: string, userId: string, r: OnlineRecipe, defaultServings: number): Promise<string> {
  const draft = {
    ...emptyDraft(defaultServings),
    title: r.recipe.title,
    servings: r.recipe.servings ?? defaultServings,
    prep_minutes: r.recipe.prepMinutes,
    image_url: r.recipe.imageUrl,
    source_url: r.url,
    instructions: r.recipe.instructions,
    course: r.course,
    ingredientLines: r.recipe.ingredients.map(ingredientToLine).join("\n"),
  };
  return saveRecipe(householdId, userId, draft, []);
}
