"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarPlus, Check, Clock, ExternalLink, ImagePlus, Link2, Minus, Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useHousehold } from "@/components/household";
import { Sheet, Spinner, toast } from "@/components/ui";
import { PhotoSearchSheet } from "@/components/photo-search";
import { RecipeNutritionCard } from "@/components/nutrition";
import { deleteUploadedPhoto } from "@/lib/photo-upload";
import { useNutrition } from "@/lib/use-nutrition";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadRecipe, splitSteps } from "@/lib/recipes";
import { courseInfo } from "@/lib/courses";
import { ingredientKey } from "@/lib/ingredients";
import { addMissingToShoppingList } from "@/lib/plan-actions";
import { addDays, dayName, formatShortDate, toISODate } from "@/lib/dates";
import { formatQuantity, roundQuantity, normalizeUnit } from "@/lib/units";
import { MEALS, type Meal, type PantryItem, type RecipeWithIngredients } from "@/lib/types";

export default function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = supabaseBrowser();
  const { household, user } = useHousehold();
  const [recipe, setRecipe] = useState<RecipeWithIngredients | null | undefined>(undefined);
  const [pantryKeys, setPantryKeys] = useState<Set<string>>(new Set());
  const [servings, setServings] = useState(household.servings);
  const [planOpen, setPlanOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [linkedTitles, setLinkedTitles] = useState<Record<string, string>>({});
  const [usedIn, setUsedIn] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const nutrition = useNutrition(household.id);

  useEffect(() => {
    loadRecipe(id).then(async (r) => {
      setRecipe(r);
      if (!r) return;
      setServings(r.is_component ? r.servings : household.servings);
      const subIds = [...new Set(r.recipe_ingredients.map((i) => i.sub_recipe_id).filter(Boolean))] as string[];
      if (subIds.length) {
        const { data } = await supabase.from("recipes").select("id, title").in("id", subIds);
        setLinkedTitles(Object.fromEntries(((data as { id: string; title: string }[]) ?? []).map((x) => [x.id, x.title])));
      }
    });
    supabase
      .from("recipe_ingredients")
      .select("recipes!recipe_ingredients_recipe_id_fkey(id, title)")
      .eq("sub_recipe_id", id)
      .then(({ data }: { data: unknown }) => {
        const rows = ((data as { recipes: { id: string; title: string } | { id: string; title: string }[] | null }[]) ?? [])
          .map((d) => (Array.isArray(d.recipes) ? d.recipes[0] : d.recipes))
          .filter(Boolean) as { id: string; title: string }[];
        setUsedIn([...new Map(rows.map((x) => [x.id, x])).values()]);
      });
    supabase
      .from("pantry_items")
      .select("name")
      .eq("household_id", household.id)
      .then(({ data }: { data: unknown }) => setPantryKeys(new Set(((data as Pick<PantryItem, "name">[]) ?? []).map((p) => ingredientKey(p.name)))));
  }, [id, household.id, household.servings, supabase]);

  const steps = useMemo(() => splitSteps(recipe?.instructions), [recipe?.instructions]);

  if (recipe === undefined) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  }
  if (recipe === null) return <p className="py-16 text-center text-muted">No s'ha trobat la recepta.</p>;

  const factor = servings / recipe.servings;
  const isAtHome = (name: string, subId: string | null) =>
    pantryKeys.has(ingredientKey(name)) || (!!subId && !!linkedTitles[subId] && pantryKeys.has(ingredientKey(linkedTitles[subId])));
  const missing = recipe.recipe_ingredients.filter((i) => !i.optional && !isAtHome(i.name, i.sub_recipe_id));
  const course = courseInfo(recipe.course);
  const nutri = nutrition.calculator
    ? nutrition.calculator.compute({
        id: recipe.id,
        title: recipe.title,
        servings: recipe.servings,
        yield_quantity: recipe.yield_quantity,
        yield_unit: recipe.yield_unit,
        ingredients: recipe.recipe_ingredients,
      })
    : null;

  async function addMissing() {
    setBusy(true);
    try {
      const added = await addMissingToShoppingList(household, user.id, [{ recipeId: recipe!.id, servings }]);
      toast(added.length ? `${added.length} ingredients afegits a la llista` : "Ja ho tens tot! 👌");
    } catch {
      toast("No s'ha pogut actualitzar la llista");
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirm(`Segur que vols esborrar "${recipe!.title}"?`)) return;
    await supabase.from("recipes").delete().eq("id", recipe!.id);
    deleteUploadedPhoto(recipe!.image_url).catch(() => {});
    toast("Recepta esborrada");
    router.replace("/receptes");
  }

  return (
    <article>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/receptes" className="btn-ghost -ml-3 !px-3">
          <ArrowLeft className="size-5" /> Receptes
        </Link>
        <div className="flex">
          <Link href={`/receptes/${recipe.id}/editar`} className="btn-ghost !px-3" aria-label="Edita">
            <Pencil className="size-5" />
          </Link>
          <button className="btn-ghost !px-3" onClick={remove} aria-label="Esborra">
            <Trash2 className="size-5" />
          </button>
        </div>
      </div>

      {recipe.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={recipe.image_url} alt="" className="mb-5 aspect-[16/10] w-full rounded-[var(--radius-card)] object-cover" referrerPolicy="no-referrer" />
      ) : (
        <button className="btn-ghost -ml-3 mb-2 !px-3 text-sm" onClick={() => setPhotoOpen(true)}>
          <ImagePlus className="size-4" /> Afegeix una foto
        </button>
      )}

      {(course || recipe.is_component) && (
        <div className="mb-2 flex flex-wrap gap-2">
          {course && (
            <span className="rounded-full bg-tomato-soft px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-tomato">
              {course.emoji} {course.label}
            </span>
          )}
          {recipe.is_component && (
            <span className="rounded-full bg-saffron-soft px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-saffron">
              Preelaborat
              {recipe.yield_quantity ? ` · en surten ${formatQuantity(Number(recipe.yield_quantity), recipe.yield_unit)}` : ""}
            </span>
          )}
        </div>
      )}

      <h1 className="text-3xl font-semibold leading-tight">{recipe.title}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        {recipe.prep_minutes && (
          <span className="flex items-center gap-1">
            <Clock className="size-4" /> {recipe.prep_minutes} min
          </span>
        )}
        {recipe.tags.map((t) => (
          <span key={t} className="rounded-full bg-line/70 px-2 py-0.5 text-xs font-semibold">
            {t}
          </span>
        ))}
        {recipe.source_url && (
          <a href={recipe.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 underline-offset-2 hover:underline">
            <ExternalLink className="size-4" /> {new URL(recipe.source_url).hostname.replace(/^www\./, "")}
          </a>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button className="btn-primary" onClick={() => setPlanOpen(true)}>
          <CalendarPlus className="size-4" /> Al menú
        </button>
        <button className="btn-secondary" onClick={addMissing} disabled={busy}>
          <ShoppingCart className="size-4" /> {busy ? "Calculant…" : "Compra el que falta"}
        </button>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Ingredients</h2>
          <div className="flex items-center gap-1 rounded-full border border-line bg-card p-1">
            <button className="grid size-8 place-items-center rounded-full active:bg-line" onClick={() => setServings((s) => Math.max(1, s - 1))} aria-label="Menys racions">
              <Minus className="size-4" />
            </button>
            <span className="min-w-20 text-center text-sm font-semibold">{servings} racions</span>
            <button className="grid size-8 place-items-center rounded-full active:bg-line" onClick={() => setServings((s) => Math.min(50, s + 1))} aria-label="Més racions">
              <Plus className="size-4" />
            </button>
          </div>
        </div>
        <ul className="card divide-y divide-line">
          {recipe.recipe_ingredients.map((ing) => {
            const atHome = isAtHome(ing.name, ing.sub_recipe_id);
            const unit = normalizeUnit(ing.unit);
            const qty = ing.quantity != null ? formatQuantity(roundQuantity(Number(ing.quantity) * factor, unit === "u" ? null : unit), ing.unit) : "";
            return (
              <li key={ing.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full ${atHome ? "bg-herb-soft text-herb" : "border border-line"}`}
                  title={atHome ? "En tens a casa" : "No en tens a casa"}
                >
                  {atHome && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="flex-1">
                  {ing.sub_recipe_id ? (
                    <Link href={`/receptes/${ing.sub_recipe_id}`} className="inline-flex items-center gap-1 font-medium text-herb underline decoration-herb/40 underline-offset-2">
                      <Link2 className="size-3.5" /> {ing.name}
                    </Link>
                  ) : (
                    ing.name
                  )}
                  {ing.optional && <span className="ml-1 text-xs text-muted">(opcional)</span>}
                </span>
                <span className="text-sm font-semibold tabular-nums text-muted">{qty}</span>
              </li>
            );
          })}
        </ul>
        {missing.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            <span className="mr-1 inline-block size-2 rounded-full bg-herb" /> en tens a casa · en falten {missing.length}
          </p>
        )}
      </section>

      <div className="mt-8">
        {nutri ? (
          <RecipeNutritionCard
            perServing={nutri.perServing}
            plate={nutri.plate}
            missing={nutri.missing}
            course={recipe.course}
            isComponent={recipe.is_component}
          />
        ) : nutrition.error === "falta_migracio" ? (
          <p className="card p-4 text-sm text-muted">
            Per veure el valor nutricional, cal executar la migració <code className="font-mono">0003_dades_nutricionals.sql</code> a Supabase.
          </p>
        ) : nutrition.loading ? (
          <div className="card grid place-items-center p-6">
            <Spinner />
          </div>
        ) : null}
      </div>

      {usedIn.length > 0 && (
        <section className="mt-6 rounded-2xl bg-saffron-soft/60 p-4">
          <h2 className="mb-2 font-sans text-xs font-bold uppercase tracking-wider text-muted">S'utilitza a</h2>
          <ul className="flex flex-wrap gap-2">
            {usedIn.map((r) => (
              <li key={r.id}>
                <Link href={`/receptes/${r.id}`} className="chip">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {steps.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xl font-semibold">Preparació</h2>
          <ol className="space-y-4" aria-label="Passos de la preparació">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-tomato-soft text-sm font-bold text-tomato" aria-hidden>
                  {i + 1}
                </span>
                <p className="pt-0.5 leading-relaxed">{s}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <PhotoSearchSheet
        open={photoOpen}
        initialQuery={recipe.title}
        onClose={() => setPhotoOpen(false)}
        onPick={async (url) => {
          setPhotoOpen(false);
          const { error } = await supabase.from("recipes").update({ image_url: url }).eq("id", recipe.id);
          if (error) toast("No s'ha pogut desar la foto");
          else {
            if (recipe.image_url !== url) deleteUploadedPhoto(recipe.image_url).catch(() => {});
            setRecipe({ ...recipe, image_url: url });
          }
        }}
      />

      <PlanSheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        onPick={async (day, meal) => {
          setPlanOpen(false);
          const { error } = await supabase.from("meal_plan").insert({
            household_id: household.id,
            day,
            meal,
            recipe_id: recipe.id,
            servings: servings === household.servings ? null : servings,
          });
          toast(error ? "No s'ha pogut afegir al menú" : `Afegida al menú: ${dayName(new Date(day + "T00:00"))} (${meal})`);
        }}
      />
    </article>
  );
}

function PlanSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (day: string, meal: Meal) => void }) {
  const [meal, setMeal] = useState<Meal>("sopar");
  const today = new Date();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  return (
    <Sheet open={open} onClose={onClose} title="Afegeix al menú">
      <div className="mb-4 grid grid-cols-3 gap-2">
        {MEALS.map((m) => (
          <button key={m.id} className="chip justify-center !py-2.5" data-active={meal === m.id} onClick={() => setMeal(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      <ul className="card divide-y divide-line">
        {days.map((d, i) => (
          <li key={i}>
            <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => onPick(toISODate(d), meal)}>
              <span className="font-medium capitalize">{i === 0 ? "Avui" : i === 1 ? "Demà" : dayName(d)}</span>
              <span className="text-sm text-muted">{formatShortDate(toISODate(d))}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
