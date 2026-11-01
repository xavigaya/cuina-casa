"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Link2, Plus } from "lucide-react";
import { useHousehold } from "./household";
import { Sheet, toast } from "./ui";
import { dishKey, linkDishToRecipe, loadDishesWithoutRecipe, type DishWithoutRecipe } from "@/lib/dishes-without-recipe";
import { dayName, formatShortDate, fromISODate, toISODate } from "@/lib/dates";
import { normalizeText } from "@/lib/sections";
import type { Recipe } from "@/lib/types";

/**
 * Plats afegits al menú només amb el nom. Es mostren destacats perquè se'n pugui
 * crear la recepta (o enllaçar-los amb una que ja existeixi).
 */
export function DishesWithoutRecipe({ recipes, onChanged }: { recipes: Recipe[]; onChanged?: () => void }) {
  const { household } = useHousehold();
  const [dishes, setDishes] = useState<DishWithoutRecipe[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [choosing, setChoosing] = useState<DishWithoutRecipe | null>(null);
  const today = toISODate(new Date());

  const load = useCallback(() => {
    loadDishesWithoutRecipe(household.id, today).then(setDishes).catch(() => {});
  }, [household.id, today]);

  useEffect(() => {
    load();
  }, [load]);

  async function link(dish: DishWithoutRecipe, recipe: Pick<Recipe, "id" | "title">) {
    setChoosing(null);
    try {
      const n = await linkDishToRecipe(household.id, dish.name, recipe.id);
      toast(`«${dish.name}» enllaçat amb «${recipe.title}»${n > 1 ? ` (${n} àpats)` : ""}`);
      load();
      onChanged?.();
    } catch {
      toast("No s'ha pogut enllaçar");
    }
  }

  if (dishes.length === 0) return null;
  const shown = showAll ? dishes : dishes.slice(0, 4);

  return (
    <section className="mb-6 overflow-hidden rounded-[var(--radius-card)] border-2 border-saffron/60 bg-saffron-soft/60">
      <div className="flex items-start gap-2 px-4 pb-2 pt-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-saffron" />
        <div>
          <h2 className="font-sans text-sm font-bold">
            {dishes.length === 1 ? "1 plat del menú sense recepta" : `${dishes.length} plats del menú sense recepta`}
          </h2>
          <p className="text-xs text-muted">Crea'n la recepta perquè compti a la llista de la compra i al valor nutricional.</p>
        </div>
      </div>
      <ul className="space-y-2 px-3 pb-3">
        {shown.map((d) => {
          const match = findMatch(d, recipes);
          const date = fromISODate(d.day);
          return (
            <li key={d.key} className="rounded-2xl bg-card p-3 shadow-sm">
              <p className="font-display text-lg font-semibold leading-snug first-letter:uppercase">{d.name}</p>
              <p className="mb-2 text-xs text-muted">
                {d.day >= today ? "Al menú " : "Era al menú "}
                <span className="capitalize">{dayName(date)}</span> {formatShortDate(d.day)}
                {d.count > 1 && ` · ${d.count} vegades`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/receptes/nova?plat=${encodeURIComponent(d.name)}`} className="btn-primary !min-h-0 flex-1 !py-2 text-sm">
                  <Plus className="size-4" /> Crea la recepta
                </Link>
                {match ? (
                  <button className="btn-secondary !min-h-0 !py-2 text-sm" onClick={() => link(d, match)} title={`Enllaça amb «${match.title}»`}>
                    <Link2 className="size-4" /> És «{match.title.length > 22 ? `${match.title.slice(0, 22)}…` : match.title}»
                  </button>
                ) : (
                  recipes.length > 0 && (
                    <button className="btn-secondary !min-h-0 !py-2 text-sm" onClick={() => setChoosing(d)}>
                      <Link2 className="size-4" /> Ja la tinc
                    </button>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {dishes.length > 4 && (
        <button className="w-full pb-3 text-xs font-bold text-saffron" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Mostra'n menys" : `Mostra'ls tots (${dishes.length})`}
        </button>
      )}

      <ChooseRecipeSheet dish={choosing} recipes={recipes} onClose={() => setChoosing(null)} onPick={(r) => choosing && link(choosing, r)} />
    </section>
  );
}

/** Recepta guardada amb el mateix nom (o que el conté), si n'hi ha. */
function findMatch(dish: DishWithoutRecipe, recipes: Recipe[]): Recipe | null {
  const exact = recipes.find((r) => dishKey(r.title) === dish.key);
  if (exact) return exact;
  if (dish.key.length < 5) return null;
  return recipes.find((r) => ` ${dishKey(r.title)} `.includes(` ${dish.key} `)) ?? null;
}

function ChooseRecipeSheet({
  dish,
  recipes,
  onClose,
  onPick,
}: {
  dish: DishWithoutRecipe | null;
  recipes: Recipe[];
  onClose: () => void;
  onPick: (r: Recipe) => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [dish]);
  const visible = recipes.filter((r) => !query || normalizeText(r.title).includes(normalizeText(query)));
  return (
    <Sheet open={!!dish} onClose={onClose} title={`Quina recepta és «${dish?.name ?? ""}»?`}>
      <input className="input mb-3" placeholder="Busca una recepta…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <ul className="card max-h-[55dvh] divide-y divide-line overflow-y-auto">
        {visible.map((r) => (
          <li key={r.id}>
            <button className="w-full px-4 py-3 text-left font-medium" onClick={() => onPick(r)}>
              {r.title}
            </button>
          </li>
        ))}
        {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Cap recepta coincideix.</li>}
      </ul>
    </Sheet>
  );
}
