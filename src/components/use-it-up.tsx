"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Globe, Sparkles } from "lucide-react";
import { useHousehold } from "./household";
import { OnlineRecipesSheet, type OnlineSearchRequest } from "./online-recipes";
import { loadRecipeGraph, type GraphRecipe } from "@/lib/plan-actions";
import { loadFoods } from "@/lib/use-nutrition";
import { buildFoodIndex, type FoodIndex } from "@/lib/nutrition";
import { suggestForExpiring } from "@/lib/cooking";

/**
 * Idees per aprofitar el que caduca aviat: receptes guardades que ho fan
 * servir (primer les que en gasten més i a les que falta menys), i cerca a
 * Internet si no n'hi ha cap.
 */
export function UseItUp({ expiring, pantry, compact = false }: { expiring: { name: string }[]; pantry: { name: string }[]; compact?: boolean }) {
  const { household } = useHousehold();
  const [recipes, setRecipes] = useState<GraphRecipe[] | null>(null);
  const [foods, setFoods] = useState<FoodIndex | null>(null);
  const [online, setOnline] = useState<OnlineSearchRequest | null>(null);

  useEffect(() => {
    let alive = true;
    loadRecipeGraph(household.id)
      .then((g) => alive && setRecipes([...g.values()]))
      .catch(() => alive && setRecipes([]));
    loadFoods(household.id)
      .then((f) => alive && setFoods(buildFoodIndex(f)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [household.id]);

  const names = useMemo(() => [...new Set(expiring.map((e) => e.name))], [expiring]);
  const ideas = useMemo(
    () => (recipes ? suggestForExpiring(names.map((name) => ({ name })), recipes, pantry, foods, compact ? 3 : 4) : []),
    [recipes, names, pantry, foods, compact],
  );

  if (!names.length || !recipes) return null;
  const query = names.slice(0, 2).join(" ");

  return (
    <div className={compact ? "border-t border-line px-4 py-3" : "card p-4"}>
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
        <Sparkles className="size-4 text-herb" /> Idees per aprofitar-ho
      </p>
      {ideas.length > 0 ? (
        <ul className="space-y-2">
          {ideas.map((r) => (
            <li key={r.id}>
              <Link href={`/receptes/${r.id}`} className="flex items-center gap-3 rounded-xl bg-paper p-2 pr-3">
                {r.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image_url} alt="" className="size-11 shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-line/60" aria-hidden>
                    🍽️
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.title}</span>
                  <span className="block truncate text-xs text-muted">
                    Fa servir {r.uses.join(", ")} · {r.missing === 0 ? "tens tota la resta" : r.missing === 1 ? "en falta 1 ingredient" : `en falten ${r.missing} ingredients`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Cap recepta guardada no fa servir {names.length === 1 ? "aquest producte" : "aquests productes"}.</p>
      )}
      <button
        className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-herb"
        onClick={() => setOnline({ query, reason: `Receptes per aprofitar ${names.slice(0, 3).join(", ")} abans que caduqui` })}
      >
        <Globe className="size-4" /> Busca&apos;n a Internet
      </button>
      <OnlineRecipesSheet request={online} onClose={() => setOnline(null)} />
    </div>
  );
}
