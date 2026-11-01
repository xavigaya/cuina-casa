"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "./supabase/client";
import { loadRecipeGraph, type GraphRecipe } from "./plan-actions";
import { buildFoodIndex, createNutritionCalculator, type Food } from "./nutrition";

let foodsCache: { householdId: string; foods: Food[] } | null = null;
const listeners = new Set<() => void>();

export async function loadFoods(householdId: string, force = false): Promise<Food[]> {
  if (!force && foodsCache?.householdId === householdId) return foodsCache.foods;
  const { data, error } = await supabaseBrowser().from("foods").select("*").order("name").limit(5000);
  if (error) throw error;
  const foods = ((data as Food[]) ?? []).map((f) => ({
    ...f,
    kcal: Number(f.kcal), carbs: Number(f.carbs), protein: Number(f.protein), fat: Number(f.fat), fiber: Number(f.fiber),
    unit_g: f.unit_g == null ? null : Number(f.unit_g),
    pack_g: f.pack_g == null ? null : Number(f.pack_g),
    density: Number(f.density) || 1,
    plate_factor: Number(f.plate_factor) || 1,
  }));
  foodsCache = { householdId, foods };
  return foods;
}

/** Avisa les pantalles obertes que la taula d'aliments ha canviat. */
export function invalidateFoods() {
  foodsCache = null;
  listeners.forEach((l) => l());
}

/**
 * Carrega els aliments i totes les receptes de la llar i torna una calculadora
 * nutricional. Si la taula d'aliments encara no existeix (falta la migració 0003),
 * `error` ho indica i la resta de l'app continua funcionant.
 */
export function useNutrition(householdId: string) {
  const [foods, setFoods] = useState<Food[] | null>(null);
  const [recipes, setRecipes] = useState<Map<string, GraphRecipe> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    const l = () => reload();
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadFoods(householdId), loadRecipeGraph(householdId)])
      .then(([f, r]) => {
        if (cancelled) return;
        setFoods(f);
        setRecipes(r);
        setError(null);
      })
      .catch((e: { message?: string; code?: string }) => {
        if (cancelled) return;
        const missingTable = e?.code === "42P01" || e?.code === "PGRST205" || /foods/.test(e?.message ?? "");
        setError(missingTable ? "falta_migracio" : e?.message ?? "error");
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, version]);

  const calculator = useMemo(() => {
    if (!foods || !recipes) return null;
    return createNutritionCalculator(recipes, buildFoodIndex(foods));
  }, [foods, recipes]);

  return { calculator, recipes, foods, error, loading: !calculator && !error, reload };
}
