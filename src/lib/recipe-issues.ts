import type { NutritionResult } from "./nutrition";
import { splitSteps } from "./recipes";

export interface RecipeIssues {
  /** Ingredients sense dades nutricionals (noms diferents) */
  unknown: number;
  /** Ingredients en unitats sense pes conegut */
  noWeight: number;
  noIngredients: boolean;
  noSteps: boolean;
}

/** Què li falta a una recepta: ingredients desconeguts, pesos, ingredients o passos. */
export function recipeIssues(
  recipe: { instructions: string | null; is_component?: boolean },
  ingredientCount: number,
  nutrition: Pick<NutritionResult, "missing"> | null,
): RecipeIssues {
  const missing = nutrition?.missing ?? [];
  return {
    unknown: new Set(missing.filter((m) => m.reason === "sense_dades").map((m) => m.name.toLowerCase())).size,
    noWeight: new Set(missing.filter((m) => m.reason === "sense_pes").map((m) => m.name.toLowerCase())).size,
    noIngredients: ingredientCount === 0,
    noSteps: splitSteps(recipe.instructions).length === 0,
  };
}

export function needsReview(i: RecipeIssues): boolean {
  return i.unknown > 0 || i.noWeight > 0 || i.noIngredients || i.noSteps;
}

/** Text curt per a la targeta del llistat. */
export function issuesLabel(i: RecipeIssues): string | null {
  if (i.noIngredients) return "Sense ingredients";
  if (i.noSteps && i.unknown + i.noWeight === 0) return "Sense passos";
  const n = i.unknown + i.noWeight;
  if (n > 0) return n === 1 ? "1 ingredient sense dades" : `${n} ingredients sense dades`;
  return null;
}
