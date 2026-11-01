"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { useHousehold } from "./household";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadRecipeGraph, type GraphRecipe } from "@/lib/plan-actions";
import { loadFoods } from "@/lib/use-nutrition";
import { buildFoodIndex, type FoodIndex } from "@/lib/nutrition";
import { buildPriceIndex, formatEuros, weekCost, type ProductPrice } from "@/lib/shopping-plus";

/** Cost aproximat dels plats de la setmana amb recepta, a partir dels preus desats */
export function WeekCost({ entries }: { entries: { recipe_id: string | null; servings: number | null; status?: string }[] }) {
  const supabase = supabaseBrowser();
  const { household } = useHousehold();
  const [graph, setGraph] = useState<Map<string, GraphRecipe> | null>(null);
  const [prices, setPrices] = useState<ProductPrice[] | null>(null);
  const [foods, setFoods] = useState<FoodIndex | null>(null);

  useEffect(() => {
    loadRecipeGraph(household.id).then(setGraph).catch(() => setGraph(new Map()));
    supabase
      .from("product_prices")
      .select("*")
      .eq("household_id", household.id)
      .then(({ data, error }: { data: unknown; error: unknown }) => setPrices(error ? [] : ((data as ProductPrice[]) ?? [])));
    loadFoods(household.id)
      .then((f) => setFoods(buildFoodIndex(f)))
      .catch(() => {});
  }, [supabase, household.id]);

  const summary = useMemo(() => {
    if (!graph || !prices?.length) return null;
    const meals = entries.filter((e) => e.recipe_id && e.status !== "proposta").map((e) => ({ recipeId: e.recipe_id!, servings: e.servings }));
    if (!meals.length) return null;
    return weekCost(meals, graph, buildPriceIndex(prices), foods, household.servings);
  }, [graph, prices, foods, entries, household.servings]);

  if (!summary || summary.priced === 0) return null;
  const pct = Math.round((summary.priced / (summary.priced + summary.missing.length)) * 100);

  return (
    <div className="card mb-6 flex items-start gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-saffron-soft text-saffron">
        <Wallet className="size-5" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p>
          <span className="font-semibold">Cost aproximat de la setmana: {formatEuros(summary.total)}</span>
          {summary.portions > 0 && <span className="text-muted"> · {formatEuros(summary.total / summary.portions)} per ració</span>}
        </p>
        {summary.missing.length > 0 && (
          <p className="mt-0.5 text-xs text-muted">
            Calculat amb el {pct}% dels ingredients; en falten {summary.missing.length} sense preu ({summary.missing.slice(0, 4).join(", ")}
            {summary.missing.length > 4 ? "…" : ""}).{" "}
            <Link href="/preus" className="font-semibold text-tomato">
              Afegeix preus
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
