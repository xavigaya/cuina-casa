"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search, ShoppingCart, Users, X } from "lucide-react";
import { useHousehold, useLiveTable } from "@/components/household";
import { PageHeader, Sheet, Spinner, toast } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { addDays, dayName, formatShortDate, formatWeekRange, startOfWeek, toISODate, weekDays } from "@/lib/dates";
import { addMissingToShoppingList } from "@/lib/plan-actions";
import { normalizeText } from "@/lib/sections";
import { MEALS, type Meal, type MealPlanEntry, type Recipe, type RecipeWithIngredients } from "@/lib/types";

type Entry = MealPlanEntry & { recipes: Pick<Recipe, "id" | "title" | "servings" | "image_url"> | null };

export default function MenuPage() {
  const supabase = supabaseBrowser();
  const { household, user } = useHousehold();
  const [monday, setMonday] = useState(() => startOfWeek(new Date()));
  const from = toISODate(monday);
  const to = toISODate(addDays(monday, 6));
  const todayISO = toISODate(new Date());

  const { rows: entries, setRows, loading, reload } = useLiveTable<Entry>("meal_plan", {
    select: "*, recipes(id, title, servings, image_url)",
    filter: (q) => q.gte("day", from).lte("day", to),
    order: { column: "created_at" },
    deps: [from, to],
  });
  const { rows: recipes } = useLiveTable<Recipe>("recipes", { order: { column: "title" }, realtime: false });

  const [slot, setSlot] = useState<{ day: string; meal: Meal } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showBreakfast, setShowBreakfast] = useState(false);

  const visibleMeals = MEALS.filter((m) => m.id !== "esmorzar" || showBreakfast || entries.some((e) => e.meal === "esmorzar"));
  const byDayMeal = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = `${e.day}|${e.meal}`;
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [entries]);

  const upcomingWithRecipe = entries.filter((e) => e.recipe_id && e.day >= todayISO);

  async function generateList() {
    if (!upcomingWithRecipe.length) return;
    setBusy(true);
    try {
      const ids = [...new Set(upcomingWithRecipe.map((e) => e.recipe_id!))];
      const { data } = await supabase.from("recipes").select("*, recipe_ingredients(*)").in("id", ids);
      const full = new Map(((data as RecipeWithIngredients[]) ?? []).map((r) => [r.id, r]));
      const meals = upcomingWithRecipe
        .filter((e) => full.has(e.recipe_id!))
        .map((e) => {
          const r = full.get(e.recipe_id!)!;
          return { servings: e.servings, recipe: { title: r.title, servings: r.servings, ingredients: r.recipe_ingredients } };
        });
      const added = await addMissingToShoppingList(household, user.id, meals);
      toast(added.length ? `${added.length} productes afegits a la llista` : "Ja tens tot el necessari 👌", added.length ? { label: "Veure", run: () => (window.location.href = "/llista") } : undefined);
    } catch {
      toast("No s'ha pogut generar la llista");
    }
    setBusy(false);
  }

  async function addEntry(values: { recipe_id: string | null; note: string | null; servings: number | null }) {
    const s = slot!;
    setSlot(null);
    const { error } = await supabase.from("meal_plan").insert({ household_id: household.id, day: s.day, meal: s.meal, ...values });
    if (error) toast("No s'ha pogut afegir");
    reload();
  }

  async function removeEntry(id: string) {
    setRows((prev) => prev.filter((e) => e.id !== id));
    await supabase.from("meal_plan").delete().eq("id", id);
  }

  return (
    <>
      <PageHeader title="Menú setmanal" subtitle={`Per a ${household.servings} persones`} />

      <div className="mb-4 flex items-center justify-between gap-2">
        <button className="btn-secondary !px-3" onClick={() => setMonday((m) => addDays(m, -7))} aria-label="Setmana anterior">
          <ChevronLeft className="size-5" />
        </button>
        <button className="text-center" onClick={() => setMonday(startOfWeek(new Date()))}>
          <p className="font-semibold">{formatWeekRange(monday)}</p>
          {from !== toISODate(startOfWeek(new Date())) && <p className="text-xs text-tomato">Torna a aquesta setmana</p>}
        </button>
        <button className="btn-secondary !px-3" onClick={() => setMonday((m) => addDays(m, 7))} aria-label="Setmana següent">
          <ChevronRight className="size-5" />
        </button>
      </div>

      <button className="btn-primary mb-6 w-full" onClick={generateList} disabled={busy || upcomingWithRecipe.length === 0}>
        <ShoppingCart className="size-4" />
        {busy ? "Calculant…" : "Genera la llista de la compra"}
      </button>

      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-3">
          {weekDays(monday).map((d) => {
            const iso = toISODate(d);
            const isToday = iso === todayISO;
            const past = iso < todayISO;
            return (
              <section key={iso} className={`card p-4 ${isToday ? "ring-2 ring-tomato" : ""} ${past ? "opacity-60" : ""}`}>
                <h2 className="mb-2 flex items-baseline gap-2 font-sans">
                  <span className="text-base font-bold capitalize">{dayName(d)}</span>
                  <span className="text-sm text-muted">{formatShortDate(iso)}</span>
                  {isToday && <span className="ml-auto text-xs font-bold uppercase text-tomato">Avui</span>}
                </h2>
                <div className="space-y-2">
                  {visibleMeals.map((m) => {
                    const list = byDayMeal.get(`${iso}|${m.id}`) ?? [];
                    return (
                      <div key={m.id} className="flex items-start gap-3">
                        <span className="w-16 shrink-0 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{m.label}</span>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          {list.map((e) => (
                            <div key={e.id} className="flex items-center gap-2 rounded-xl bg-paper px-3 py-2">
                              {e.recipes ? (
                                <Link href={`/receptes/${e.recipes.id}`} className="min-w-0 flex-1 truncate font-medium">
                                  {e.recipes.title}
                                </Link>
                              ) : (
                                <span className="min-w-0 flex-1 truncate font-medium italic">{e.note ?? "—"}</span>
                              )}
                              {e.servings && e.servings !== household.servings && (
                                <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted">
                                  <Users className="size-3" /> {e.servings}
                                </span>
                              )}
                              <button className="-mr-1 shrink-0 p-1 text-muted" onClick={() => removeEntry(e.id)} aria-label="Treu del menú">
                                <X className="size-4" />
                              </button>
                            </div>
                          ))}
                          {list.length === 0 && (
                            <button
                              className="flex w-full items-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-muted"
                              onClick={() => setSlot({ day: iso, meal: m.id })}
                            >
                              <Plus className="size-4" /> Afegeix
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {!showBreakfast && !entries.some((e) => e.meal === "esmorzar") && (
            <button className="btn-ghost mx-auto flex text-sm" onClick={() => setShowBreakfast(true)}>
              Mostra també els esmorzars
            </button>
          )}
        </div>
      )}

      <Sheet open={!!slot} onClose={() => setSlot(null)} title={slot ? `${MEALS.find((m) => m.id === slot.meal)?.label} · ${formatShortDate(slot.day)}` : ""}>
        {slot && <PickRecipe key={`${slot.day}${slot.meal}`} recipes={recipes} defaultServings={household.servings} onPick={addEntry} />}
      </Sheet>
    </>
  );
}

function PickRecipe({
  recipes,
  defaultServings,
  onPick,
}: {
  recipes: Recipe[];
  defaultServings: number;
  onPick: (v: { recipe_id: string | null; note: string | null; servings: number | null }) => void;
}) {
  const [query, setQuery] = useState("");
  const [servings, setServings] = useState(defaultServings);
  const visible = recipes.filter((r) => !query || normalizeText(r.title).includes(normalizeText(query)));
  const s = servings === defaultServings ? null : servings;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-card px-4 py-2 ring-1 ring-line">
        <span className="text-sm font-semibold text-muted">Racions</span>
        <div className="flex items-center gap-2">
          <button className="grid size-8 place-items-center rounded-full ring-1 ring-line" onClick={() => setServings((v) => Math.max(1, v - 1))} aria-label="Menys">
            −
          </button>
          <span className="w-6 text-center font-semibold">{servings}</span>
          <button className="grid size-8 place-items-center rounded-full ring-1 ring-line" onClick={() => setServings((v) => Math.min(50, v + 1))} aria-label="Més">
            +
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input className="input !pl-10" placeholder="Busca una recepta o escriu un plat…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>

      {query.trim() && (
        <button className="btn-secondary w-full !justify-start" onClick={() => onPick({ recipe_id: null, note: query.trim(), servings: s })}>
          <Plus className="size-4" /> Afegeix "{query.trim()}" sense recepta
        </button>
      )}

      {recipes.length === 0 ? (
        <p className="text-center text-sm text-muted">
          Encara no tens receptes. Pots escriure el nom d'un plat, o{" "}
          <Link href="/receptes/nova" className="text-tomato underline">
            crear una recepta
          </Link>
          .
        </p>
      ) : (
        <ul className="card max-h-[45dvh] divide-y divide-line overflow-y-auto">
          {visible.map((r) => (
            <li key={r.id}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => onPick({ recipe_id: r.id, note: null, servings: s })}>
                {r.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image_url} alt="" className="size-10 shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-line/60" aria-hidden>
                    🍽️
                  </span>
                )}
                <span className="font-medium">{r.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
