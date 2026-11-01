"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarPlus, Check, ChefHat, CookingPot, Clock, Copy, ExternalLink, ImagePlus, Languages, Lightbulb, Link2, Minus, Pencil, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { useHousehold, usePermissions } from "@/components/household";
import { canModify, isProposal } from "@/lib/permissions";
import { setStatus, undoLatest } from "@/lib/proposals";
import { Sheet, Spinner, toast } from "@/components/ui";
import { PhotoSearchSheet } from "@/components/photo-search";
import { CookedSheet } from "@/components/cooked-sheet";
import { RecipeNutritionCard } from "@/components/nutrition";
import { MissingDataHelper } from "@/components/missing-data";
import { OnlineRecipesSheet, type OnlineSearchRequest } from "@/components/online-recipes";
import type { OnlineRecipe } from "@/lib/online-recipes";
import { photoFromUrl } from "@/lib/photo-upload";
import { useNutrition } from "@/lib/use-nutrition";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadRecipe, splitSteps } from "@/lib/recipes";
import { courseInfo } from "@/lib/courses";
import { ingredientKey } from "@/lib/ingredients";
import { looksSpanish } from "@/lib/translate";
import { guessSection } from "@/lib/sections";
import { addMissingToShoppingList } from "@/lib/plan-actions";
import { addDays, dayName, formatShortDate, toISODate } from "@/lib/dates";
import { formatQuantity, roundQuantity, normalizeUnit } from "@/lib/units";
import { MEALS, type Meal, type PantryItem, type RecipeWithIngredients } from "@/lib/types";

export default function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const supabase = supabaseBrowser();
  const { household, user, members } = useHousehold();
  const perms = usePermissions();
  const [recipe, setRecipe] = useState<RecipeWithIngredients | null | undefined>(undefined);
  const [pantryKeys, setPantryKeys] = useState<Set<string>>(new Set());
  const [servings, setServings] = useState(household.servings);
  const [planOpen, setPlanOpen] = useState(false);
  const [cookedOpen, setCookedOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [linkedTitles, setLinkedTitles] = useState<Record<string, string>>({});
  const [usedIn, setUsedIn] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [onlineReq, setOnlineReq] = useState<OnlineSearchRequest | null>(null);
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

  const editable = canModify(perms, recipe);
  const author = recipe.created_by ? members.find((m) => m.user_id === recipe.created_by)?.display_name : null;
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

  const isSpanish = looksSpanish([recipe.title, ...recipe.recipe_ingredients.map((i) => i.name), recipe.instructions ?? ""].join("\n"));

  async function translate() {
    setTranslating(true);
    try {
      const ings = [...recipe!.recipe_ingredients].sort((a, b) => a.position - b.position);
      const stepsList = splitSteps(recipe!.instructions);
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: [recipe!.title, ...ings.map((i) => i.name), ...stepsList] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      const t = json.lines as string[];
      const title = t[0].charAt(0).toUpperCase() + t[0].slice(1);
      const names = t.slice(1, 1 + ings.length);
      const instructions = t.slice(1 + ings.length).join("\n") || null;
      // Es tradueix fila a fila per conservar quantitats i enllaços amb preelaborats
      const results = await Promise.all([
        supabase.from("recipes").update({ title, instructions }).eq("id", recipe!.id),
        ...ings.map((ing, k) =>
          supabase
            .from("recipe_ingredients")
            .update({ name: names[k] || ing.name, section: ing.section !== "altres" ? ing.section : guessSection(names[k] || ing.name) })
            .eq("id", ing.id),
        ),
      ]);
      if (results.some((r) => r.error)) throw new Error("No s'ha pogut desar tota la traducció");
      const fresh = await loadRecipe(recipe!.id);
      if (fresh) setRecipe(fresh);
      nutrition.reload();
      toast("Recepta traduïda al català");
    } catch (e) {
      toast((e as Error).message);
    }
    setTranslating(false);
  }

  const missingParts = [
    recipe.recipe_ingredients.length === 0 && "els ingredients",
    steps.length === 0 && "els passos de preparació",
  ].filter(Boolean) as string[];

  /** Omple el que falta de la recepta amb una recepta trobada a Internet (sense tocar el que ja hi ha). */
  async function completeFrom(r: OnlineRecipe) {
    const current = recipe!;
    const updates: Record<string, unknown> = {};
    if (!current.instructions?.trim() && r.recipe.instructions) updates.instructions = r.recipe.instructions;
    if (!current.prep_minutes && r.recipe.prepMinutes) updates.prep_minutes = r.recipe.prepMinutes;
    if (!current.source_url) updates.source_url = r.url;
    if (!current.course && r.course) updates.course = r.course;
    if (!current.image_url && r.recipe.imageUrl) {
      updates.image_url = await photoFromUrl(household.id, r.recipe.imageUrl).catch(() => r.recipe.imageUrl);
    }
    if (Object.keys(updates).length) {
      const { error } = await supabase.from("recipes").update(updates).eq("id", current.id);
      if (error) throw error;
    }
    if (current.recipe_ingredients.length === 0 && r.recipe.ingredients.length) {
      // Les quantitats s'adapten a les racions de la nostra recepta
      const factor = r.recipe.servings ? current.servings / r.recipe.servings : 1;
      const { error } = await supabase.from("recipe_ingredients").insert(
        r.recipe.ingredients.map((ing, position) => ({
          recipe_id: current.id,
          position,
          name: ing.name,
          quantity: ing.quantity == null ? null : roundQuantity(ing.quantity * factor, ing.unit === "u" ? null : ing.unit),
          unit: ing.unit,
          section: ing.section,
          optional: ing.optional,
        })),
      );
      if (error) throw error;
    }
    const fresh = await loadRecipe(current.id);
    if (fresh) setRecipe(fresh);
    nutrition.reload();
    toast(`Recepta completada amb la de ${r.site}`);
  }

  async function remove(reject = false) {
    const r = recipe!;
    const question = reject ? `Rebutges la proposta "${r.title}"? S'esborrarà (es pot desfer des del Registre).` : `Segur que vols esborrar "${r.title}"?`;
    if (!confirm(question)) return;
    const { error } = await supabase.from("recipes").delete().eq("id", r.id);
    if (error) {
      toast("No s'ha pogut esborrar");
      return;
    }
    // La foto no s'esborra del magatzem: així, si es desfà, la recepta torna sencera
    toast(reject ? "Proposta rebutjada" : "Recepta esborrada", {
      label: "Desfés",
      run: async () => {
        const err = await undoLatest("recipes", r.id);
        if (err) toast(err);
        else {
          toast("Recepta recuperada");
          router.push(`/receptes/${r.id}`);
        }
      },
    });
    router.replace("/receptes");
  }

  async function approve() {
    const err = await setStatus("recipes", [recipe!.id], "aprovada");
    if (err) toast("No s'ha pogut aprovar");
    else {
      setRecipe({ ...recipe!, status: "aprovada" });
      toast("Recepta aprovada");
    }
  }

  return (
    <article>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/receptes" className="btn-ghost -ml-3 !px-3">
          <ArrowLeft className="size-5" /> Receptes
        </Link>
        <div className="flex">
          {editable && (
            <Link href={`/receptes/${recipe.id}/editar`} className="btn-ghost !px-3" aria-label="Edita" title="Edita">
              <Pencil className="size-5" />
            </Link>
          )}
          <Link href={`/receptes/nova?copia=${recipe.id}`} className="btn-ghost !px-3" aria-label="Duplica per fer-ne una variació" title="Duplica">
            <Copy className="size-5" />
          </Link>
          {editable && (
            <button className="btn-ghost !px-3" onClick={() => remove()} aria-label="Esborra">
              <Trash2 className="size-5" />
            </button>
          )}
        </div>
      </div>

      {isProposal(recipe) && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-herb/50 bg-herb-soft/60 p-3 text-sm">
          <Lightbulb className="size-5 shrink-0 text-herb" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">Proposta{author ? ` de ${author}` : ""}.</span>{" "}
            {perms.privileged ? "Revisa-la i aprova-la perquè formi part del receptari." : "Pendent que una persona privilegiada l'aprovi."}
          </p>
          {perms.privileged && (
            <div className="flex shrink-0 gap-2">
              <button className="flex items-center gap-1 rounded-full bg-paper px-3 py-1.5 text-xs font-bold text-tomato ring-1 ring-line" onClick={() => remove(true)}>
                <X className="size-3.5" /> Rebutja
              </button>
              <button className="flex items-center gap-1 rounded-full bg-herb px-3 py-1.5 text-xs font-bold text-paper" onClick={approve}>
                <Check className="size-3.5" /> Aprova
              </button>
            </div>
          )}
        </div>
      )}

      {recipe.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={recipe.image_url} alt="" className="mb-5 aspect-[16/10] w-full rounded-[var(--radius-card)] object-cover" referrerPolicy="no-referrer" />
      ) : editable ? (
        <button className="btn-ghost -ml-3 mb-2 !px-3 text-sm" onClick={() => setPhotoOpen(true)}>
          <ImagePlus className="size-4" /> Afegeix una foto
        </button>
      ) : null}

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

      {editable && missingParts.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-saffron/60 bg-saffron-soft/60 p-3 text-sm">
          <p className="min-w-0 flex-1">A aquesta recepta li falten {missingParts.join(" i ")}.</p>
          <button
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-herb px-3 py-1.5 text-xs font-bold text-paper"
            onClick={() =>
              setOnlineReq({
                query: recipe.title,
                reason: `Tria una recepta d'Internet per completar ${missingParts.join(" i ")}. El que ja tens no es canviarà`,
                complete: { label: "Completa amb aquesta", run: completeFrom },
              })
            }
          >
            Busca-la a Internet
          </button>
        </div>
      )}

      {editable && isSpanish && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-herb-soft/60 p-3 text-sm">
          <Languages className="size-4 shrink-0 text-herb" />
          <p className="flex-1">Aquesta recepta és en castellà.</p>
          <button className="shrink-0 rounded-full bg-herb px-3 py-1.5 text-xs font-bold text-paper" onClick={translate} disabled={translating}>
            {translating ? "Traduint…" : "Tradueix al català"}
          </button>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <Link href={`/receptes/${recipe.id}/cuinar?racions=${servings}`} className="btn-primary">
          <ChefHat className="size-4" /> Cuina-la
        </Link>
        <button className="btn-secondary" onClick={() => setCookedOpen(true)}>
          <CookingPot className="size-4" /> L&apos;he cuinada
        </button>
        <button className="btn-secondary" onClick={() => setPlanOpen(true)}>
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
            missingSlot={<MissingDataHelper missing={nutri.missing} />}
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

      <OnlineRecipesSheet request={onlineReq} onClose={() => setOnlineReq(null)} />

      <PhotoSearchSheet
        open={photoOpen}
        initialQuery={recipe.title}
        onClose={() => setPhotoOpen(false)}
        onPick={async (url) => {
          setPhotoOpen(false);
          const { error } = await supabase.from("recipes").update({ image_url: url }).eq("id", recipe.id);
          if (error) toast("No s'ha pogut desar la foto");
          else setRecipe({ ...recipe, image_url: url });
        }}
      />

      <CookedSheet
        open={cookedOpen}
        onClose={() => setCookedOpen(false)}
        recipeId={recipe.id}
        servings={servings}
        onDone={() =>
          supabase
            .from("pantry_items")
            .select("name")
            .eq("household_id", household.id)
            .then(({ data }: { data: unknown }) => setPantryKeys(new Set(((data as Pick<PantryItem, "name">[]) ?? []).map((p) => ingredientKey(p.name)))))
        }
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
          toast(
            error
              ? "No s'ha pogut afegir al menú"
              : `${perms.privileged ? "Afegida al menú" : "Proposada per al menú"}: ${dayName(new Date(day + "T00:00"))} (${meal})`,
          );
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
