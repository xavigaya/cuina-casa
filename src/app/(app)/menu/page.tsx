"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, CheckCheck, ChevronLeft, LayoutTemplate, ChevronRight, Plus, Search, ShoppingCart, Users, X } from "lucide-react";
import { useHousehold, useLiveTable, usePermissions } from "@/components/household";
import { canModify, isProposal } from "@/lib/permissions";
import { setStatus, undoLatest } from "@/lib/proposals";
import { PageHeader, Sheet, Spinner, toast } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { addDays, dayName, formatShortDate, formatWeekRange, startOfWeek, toISODate, weekDays } from "@/lib/dates";
import { addMissingToShoppingList } from "@/lib/plan-actions";
import { normalizeText } from "@/lib/sections";
import { COURSES, COURSE_ORDER, courseInfo, type Course } from "@/lib/courses";
import { MEALS, type Meal, type MealPlanEntry, type Recipe } from "@/lib/types";
import { useNutrition } from "@/lib/use-nutrition";
import { analyzeWeek } from "@/lib/menu-analysis";
import type { Proposal } from "@/lib/harvard";
import { DayFooter, WeekSummary, WeekendCard } from "@/components/menu-nutrition";
import { OnlineRecipesSheet, type OnlineSearchRequest } from "@/components/online-recipes";
import { MenuTemplatesSheet } from "@/components/menu-templates";

type Entry = MealPlanEntry & { recipes: Pick<Recipe, "id" | "title" | "servings" | "image_url" | "course"> | null };

export default function MenuPage() {
  const supabase = supabaseBrowser();
  const { household, user, members } = useHousehold();
  const perms = usePermissions();
  const [monday, setMonday] = useState(() => startOfWeek(new Date()));
  const from = toISODate(monday);
  const to = toISODate(addDays(monday, 6));
  const todayISO = toISODate(new Date());

  const { rows: entries, setRows, loading, reload } = useLiveTable<Entry>("meal_plan", {
    select: "*, recipes(id, title, servings, image_url, course)",
    filter: (q) => q.gte("day", from).lte("day", to),
    order: { column: "created_at" },
    deps: [from, to],
  });
  const { rows: recipes } = useLiveTable<Recipe>("recipes", { order: { column: "title" }, realtime: false });

  const [slot, setSlot] = useState<{ day: string; meal: Meal } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showBreakfast, setShowBreakfast] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const recipeIds = useMemo(() => new Set(recipes.map((r) => r.id)), [recipes]);
  const nutrition = useNutrition(household.id);
  const [onlineReq, setOnlineReq] = useState<OnlineSearchRequest | null>(null);
  const dayList = useMemo(() => weekDays(monday).map(toISODate), [monday]);

  const analysis = useMemo(() => {
    const calc = nutrition.calculator;
    if (!calc || !nutrition.recipes) return null;
    const candidates = [...nutrition.recipes.values()]
      .filter((r) => !r.is_component && r.course !== "postres")
      .map((r) => ({ id: r.id, title: r.title, course: r.course, plate: calc.byId(r.id)?.plate ?? {} }));
    return analyzeWeek(entries, dayList, todayISO, (id) => calc.byId(id), candidates);
  }, [nutrition.calculator, nutrition.recipes, entries, dayList, todayISO]);

  async function addProposal(day: string, meal: Meal, proposal: Proposal) {
    const { error } = await supabase
      .from("meal_plan")
      .insert(proposal.recipes.map((r) => ({ household_id: household.id, day, meal, recipe_id: r.id })));
    toast(error ? "No s'ha pogut afegir" : `${perms.privileged ? "Afegit al" : "Proposat per al"} ${MEALS.find((m) => m.id === meal)?.label.toLowerCase()}`);
    reload();
  }

  const visibleMeals = MEALS.filter((m) => m.id !== "esmorzar" || showBreakfast || entries.some((e) => e.meal === "esmorzar"));
  const byDayMeal = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const k = `${e.day}|${e.meal}`;
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (COURSE_ORDER[a.recipes?.course ?? ""] ?? 9) - (COURSE_ORDER[b.recipes?.course ?? ""] ?? 9));
    }
    return map;
  }, [entries]);

  // Les propostes pendents no compten per a la llista de la compra fins que s'aproven
  const upcomingWithRecipe = entries.filter((e) => e.recipe_id && e.day >= todayISO && !isProposal(e));
  const proposals = entries.filter(isProposal);
  const authorName = (id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? null;

  async function approve(ids: string[]) {
    setRows((prev) => prev.map((e) => (ids.includes(e.id) ? { ...e, status: "aprovada" } : e)));
    const err = await setStatus("meal_plan", ids, "aprovada");
    toast(err ? "No s'ha pogut aprovar" : ids.length > 1 ? `${ids.length} propostes aprovades` : "Proposta aprovada");
    reload();
  }

  async function generateList() {
    if (!upcomingWithRecipe.length) return;
    setBusy(true);
    try {
      const meals = upcomingWithRecipe.map((e) => ({ recipeId: e.recipe_id!, servings: e.servings }));
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
    else if (!perms.privileged) toast("Proposta afegida: una persona privilegiada l'ha d'aprovar");
    reload();
  }

  async function removeEntry(e: Entry) {
    setRows((prev) => prev.filter((x) => x.id !== e.id));
    const { error } = await supabase.from("meal_plan").delete().eq("id", e.id);
    if (error) {
      toast("No s'ha pogut treure");
      reload();
      return;
    }
    const rejected = isProposal(e) && e.created_by !== user.id;
    toast(rejected ? "Proposta rebutjada" : "Tret del menú", {
      label: "Desfés",
      run: async () => {
        const err = await undoLatest("meal_plan", e.id);
        toast(err ?? "Recuperat");
        reload();
      },
    });
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

      {perms.privileged && proposals.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl border-2 border-herb/50 bg-herb-soft/60 p-3 text-sm">
          <p className="min-w-0 flex-1">
            <span className="font-semibold">{proposals.length === 1 ? "1 proposta" : `${proposals.length} propostes`}</span> per revisar aquesta setmana.
          </p>
          <button className="flex shrink-0 items-center gap-1 rounded-full bg-herb px-3 py-1.5 text-xs font-bold text-paper" onClick={() => approve(proposals.map((p) => p.id))}>
            <CheckCheck className="size-3.5" /> Aprova-les totes
          </button>
        </div>
      )}
      {!perms.privileged && proposals.some((p) => p.created_by === user.id) && (
        <p className="mb-4 rounded-2xl bg-herb-soft/60 p-3 text-sm">
          Els plats que afegeixes queden com a <span className="font-semibold">proposta</span> fins que una persona privilegiada els aprova.
        </p>
      )}

      <div className="mb-6 flex gap-2">
        <button className="btn-primary flex-1" onClick={generateList} disabled={busy || upcomingWithRecipe.length === 0}>
          <ShoppingCart className="size-4" />
          {busy ? "Calculant…" : "Genera la llista de la compra"}
        </button>
        <button className="btn-secondary shrink-0 !px-3" onClick={() => setTemplatesOpen(true)} aria-label="Plantilles de menú" title="Plantilles de menú">
          <LayoutTemplate className="size-5" />
        </button>
      </div>

      {analysis && analysis.daysWithData > 0 && <WeekSummary analysis={analysis} />}

      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-3">
          {weekDays(monday).map((d, dayIndex) => {
            const iso = toISODate(d);
            const isToday = iso === todayISO;
            const past = iso < todayISO;
            const dayAnalysis = analysis?.days.find((a) => a.day === iso);
            return (
              <div key={iso} className="space-y-3">
              {dayIndex === 5 && analysis && analysis.weekend.imbalance && analysis.weekend.slots.length > 0 && (
                <WeekendCard
                  proposals={analysis.weekend.proposals}
                  slots={analysis.weekend.slots}
                  imbalance={analysis.weekend.imbalance}
                  onAdd={(slot, p) => addProposal(slot.day, slot.meal, p)}
                  onSearchOnline={(slot, imbalance, reason) => setOnlineReq({ imbalance, reason, target: slot })}
                />
              )}
              <section className={`card p-4 ${isToday ? "ring-2 ring-tomato" : ""} ${past ? "opacity-60" : ""}`}>
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
                          {list.map((e) => {
                            const proposal = isProposal(e);
                            const author = proposal ? authorName(e.created_by) : null;
                            return (
                            <div
                              key={e.id}
                              className={`flex items-center gap-2 rounded-xl px-3 py-2 ${proposal ? "border border-dashed border-herb/70 bg-herb-soft/40" : "bg-paper"}`}
                            >
                              {e.recipes ? (
                                <Link href={`/receptes/${e.recipes.id}`} className="min-w-0 flex-1 truncate font-medium">
                                  {courseInfo(e.recipes.course) && (
                                    <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">{courseInfo(e.recipes.course)!.label}</span>
                                  )}
                                  {e.recipes.title}
                                </Link>
                              ) : (
                                <Link
                                  href={e.note ? `/receptes/nova?plat=${encodeURIComponent(e.note)}` : "#"}
                                  className="min-w-0 flex-1 truncate font-medium italic"
                                  title="Plat sense recepta: toca per crear-la"
                                >
                                  {e.note ?? "—"}
                                  <span className="ml-1.5 rounded-full bg-saffron-soft px-1.5 py-px text-[10px] font-bold not-italic uppercase text-saffron">sense recepta</span>
                                </Link>
                              )}
                              {e.servings && e.servings !== household.servings && (
                                <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted">
                                  <Users className="size-3" /> {e.servings}
                                </span>
                              )}
                              {proposal && (
                                <span
                                  className="shrink-0 rounded-full bg-herb px-1.5 py-px text-[10px] font-bold uppercase text-white"
                                  title={author ? `Proposta de ${author}` : "Proposta pendent d'aprovar"}
                                >
                                  proposta
                                </span>
                              )}
                              {proposal && perms.privileged && (
                                <button className="shrink-0 rounded-full p-1 text-herb" onClick={() => approve([e.id])} aria-label="Aprova la proposta" title="Aprova">
                                  <Check className="size-4" strokeWidth={3} />
                                </button>
                              )}
                              {canModify(perms, e) && (
                                <button
                                  className="-mr-1 shrink-0 p-1 text-muted"
                                  onClick={() => removeEntry(e)}
                                  aria-label={proposal && e.created_by !== user.id ? "Rebutja la proposta" : "Treu del menú"}
                                  title={proposal && e.created_by !== user.id ? "Rebutja" : "Treu"}
                                >
                                  <X className="size-4" />
                                </button>
                              )}
                            </div>
                            );
                          })}
                          {list.length === 0 ? (
                            <button
                              className="flex w-full items-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-muted"
                              onClick={() => setSlot({ day: iso, meal: m.id })}
                            >
                              <Plus className="size-4" /> Afegeix
                            </button>
                          ) : (
                            <button className="flex items-center gap-1 px-1 text-xs font-semibold text-muted" onClick={() => setSlot({ day: iso, meal: m.id })}>
                              <Plus className="size-3.5" /> Un altre plat
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {dayAnalysis && (
                  <DayFooter
                    analysis={dayAnalysis}
                    onAdd={(p) => addProposal(iso, "sopar", p)}
                    onSearchOnline={(imbalance, reason) => setOnlineReq({ imbalance, reason, target: { day: iso, meal: "sopar" } })}
                  />
                )}
              </section>
              </div>
            );
          })}
          {!showBreakfast && !entries.some((e) => e.meal === "esmorzar") && (
            <button className="btn-ghost mx-auto flex text-sm" onClick={() => setShowBreakfast(true)}>
              Mostra també els esmorzars
            </button>
          )}
        </div>
      )}

      <MenuTemplatesSheet
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        mondayISO={from}
        week={entries}
        recipeIds={recipeIds}
        onApplied={reload}
      />

      <OnlineRecipesSheet
        request={onlineReq}
        onClose={() => setOnlineReq(null)}
        onImported={() => {
          reload();
          nutrition.reload();
        }}
      />

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
  const [course, setCourse] = useState<Course | "base" | null>(null);
  const visible = recipes.filter(
    (r) =>
      (!query || normalizeText(r.title).includes(normalizeText(query))) &&
      (course === "base" ? r.is_component : course ? r.course === course : !r.is_component || !!r.course),
  );
  const hasComponents = recipes.some((r) => r.is_component);
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

      {recipes.length > 0 && (
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          <button className="chip" data-active={course === null} onClick={() => setCourse(null)}>
            Tots
          </button>
          {COURSES.filter((c) => recipes.some((r) => r.course === c.id)).map((c) => (
            <button key={c.id} className="chip" data-active={course === c.id} onClick={() => setCourse(course === c.id ? null : c.id)}>
              {c.emoji} {c.plural}
            </button>
          ))}
          {hasComponents && (
            <button className="chip" data-active={course === "base"} onClick={() => setCourse(course === "base" ? null : "base")}>
              Preelaborats
            </button>
          )}
        </div>
      )}

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
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{r.title}</span>
                  {courseInfo(r.course) && <span className="text-xs text-muted">{courseInfo(r.course)!.label}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

