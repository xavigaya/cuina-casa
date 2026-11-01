"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, Lightbulb, ShoppingCart } from "lucide-react";
import { useHousehold, useLiveTable, usePermissions } from "@/components/household";
import { isProposal } from "@/lib/permissions";
import { Spinner, toast } from "@/components/ui";
import { UseItUp } from "@/components/use-it-up";
import { supabaseBrowser } from "@/lib/supabase/client";
import { dayName, expiryLabel, expiryStatus, formatShortDate, toISODate } from "@/lib/dates";
import { notifyExpiring } from "@/lib/notifications";
import { formatQuantity } from "@/lib/units";
import { LOCATIONS, MEALS, type MealPlanEntry, type PantryItem, type Recipe, type ShoppingItem } from "@/lib/types";

type Entry = MealPlanEntry & { recipes: Pick<Recipe, "id" | "title" | "image_url"> | null };

export default function HomePage() {
  const supabase = supabaseBrowser();
  const { household, members, user } = useHousehold();
  const today = toISODate(new Date());
  const me = members.find((m) => m.user_id === user.id);
  const firstName = me?.display_name || (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] || "";

  const { rows: pantry, loading: lp } = useLiveTable<PantryItem>("pantry_items");
  const { rows: list, loading: ll } = useLiveTable<ShoppingItem>("shopping_items", { filter: (q) => q.eq("checked", false) });
  const { rows: meals, loading: lm } = useLiveTable<Entry>("meal_plan", {
    select: "*, recipes(id, title, image_url)",
    filter: (q) => q.eq("day", today),
    deps: [today],
  });

  // Propostes pendents d'aprovar (només les veuen com a tasca els privilegiats)
  const { privileged } = usePermissions();
  const [pending, setPending] = useState<{ recipes: number; meals: number }>({ recipes: 0, meals: 0 });
  useEffect(() => {
    if (!privileged) return;
    Promise.all([
      supabase.from("recipes").select("id", { count: "exact", head: true }).eq("household_id", household.id).eq("status", "proposta"),
      supabase.from("meal_plan").select("id", { count: "exact", head: true }).eq("household_id", household.id).eq("status", "proposta").gte("day", today),
    ]).then(([r, m]) => setPending({ recipes: r.error ? 0 : (r.count ?? 0), meals: m.error ? 0 : (m.count ?? 0) }));
  }, [privileged, supabase, household.id, today]);

  const warn = household.expiry_warning_days;
  const expiring = useMemo(
    () =>
      pantry
        .filter((p) => ["caducat", "avui", "aviat"].includes(expiryStatus(p.expires_on, warn)))
        .sort((a, b) => (a.expires_on ?? "").localeCompare(b.expires_on ?? "")),
    [pantry, warn],
  );
  const low = pantry.filter((p) => p.min_quantity != null && Number(p.quantity ?? 0) < p.min_quantity);
  const listNames = new Set(list.map((i) => i.name.toLowerCase()));

  useEffect(() => {
    if (!lp) notifyExpiring(expiring);
  }, [lp, expiring]);

  async function addLowToList() {
    const toAdd = low.filter((p) => !listNames.has(p.name.toLowerCase()));
    if (!toAdd.length) return toast("Ja són tots a la llista");
    await supabase.from("shopping_items").insert(
      toAdd.map((p) => ({ household_id: household.id, name: p.name, section: p.section, source: "rebost", added_by: user.id })),
    );
    toast(`${toAdd.length} productes afegits a la llista`);
  }

  const hour = new Date().getHours();
  const greeting = hour < 14 ? "Bon dia" : hour < 21 ? "Bona tarda" : "Bona nit";

  if (lp || ll || lm) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="mb-2">
        <p className="text-sm font-semibold capitalize text-muted">
          {dayName(new Date())}, {formatShortDate(today)}
        </p>
        <h1 className="text-3xl font-semibold">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h1>
      </header>

      {privileged && pending.recipes + pending.meals > 0 && (
        <section className="card flex items-start gap-3 border-herb/50 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-herb-soft text-herb">
            <Lightbulb className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Propostes per revisar</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-herb">
              {pending.recipes > 0 && (
                <Link href="/receptes" className="flex items-center gap-1">
                  {pending.recipes === 1 ? "1 recepta" : `${pending.recipes} receptes`} <ArrowRight className="size-3.5" />
                </Link>
              )}
              {pending.meals > 0 && (
                <Link href="/menu" className="flex items-center gap-1">
                  {pending.meals === 1 ? "1 plat del menú" : `${pending.meals} plats del menú`} <ArrowRight className="size-3.5" />
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {expiring.length > 0 && (
        <section className="card overflow-hidden border-saffron/50">
          <div className="flex items-center gap-2 bg-saffron-soft px-4 py-3">
            <AlertTriangle className="size-5 text-saffron" />
            <h2 className="flex-1 font-sans text-sm font-bold">
              {expiring.length === 1 ? "1 producte caduca aviat" : `${expiring.length} productes caduquen aviat`}
            </h2>
          </div>
          <ul className="divide-y divide-line">
            {expiring.slice(0, 6).map((p) => {
              const st = expiryStatus(p.expires_on, warn);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="text-xs text-muted">{LOCATIONS.find((l) => l.id === p.location)?.label}</span>
                  </span>
                  <span className={`shrink-0 text-sm font-semibold ${st === "caducat" || st === "avui" ? "text-tomato" : "text-saffron"}`}>
                    {expiryLabel(p.expires_on)}
                  </span>
                </li>
              );
            })}
          </ul>
          <UseItUp expiring={expiring.filter((p) => expiryStatus(p.expires_on, warn) !== "caducat")} pantry={pantry} compact />
          <Link href="/rebost" className="flex items-center justify-end gap-1 border-t border-line px-4 py-3 text-sm font-semibold text-tomato">
            Obre el rebost <ArrowRight className="size-4" />
          </Link>
        </section>
      )}

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-sans text-sm font-bold uppercase tracking-wider text-muted">
            <CalendarDays className="size-4" /> Avui es menja
          </h2>
          <Link href="/menu" className="text-sm font-semibold text-tomato">
            Menú
          </Link>
        </div>
        {meals.length === 0 ? (
          <p className="text-muted">
            Encara no hi ha res planificat.{" "}
            <Link href="/menu" className="font-semibold text-tomato">
              Planifica la setmana
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {MEALS.map((m) =>
              meals
                .filter((e) => e.meal === m.id)
                .map((e) => (
                  <li key={e.id} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs font-semibold uppercase text-muted">{m.label}</span>
                    {e.recipes ? (
                      <Link href={`/receptes/${e.recipes.id}`} className="font-display text-lg font-semibold leading-tight">
                        {e.recipes.title}
                      </Link>
                    ) : (
                      <span className="font-display text-lg italic">{e.note}</span>
                    )}
                    {isProposal(e) && <span className="rounded-full bg-herb px-1.5 py-px text-[10px] font-bold uppercase text-white">proposta</span>}
                  </li>
                )),
            )}
          </ul>
        )}
      </section>

      <Link href="/llista" className="card flex items-center gap-4 p-4 transition active:scale-[0.99]">
        <span className="grid size-12 place-items-center rounded-2xl bg-tomato-soft text-tomato">
          <ShoppingCart className="size-6" />
        </span>
        <span className="flex-1">
          <span className="block font-semibold">Llista de la compra</span>
          <span className="text-sm text-muted">
            {list.length === 0 ? "No falta res" : list.length === 1 ? "1 producte per comprar" : `${list.length} productes per comprar`}
          </span>
        </span>
        <ArrowRight className="size-5 text-muted" />
      </Link>

      {low.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 font-sans text-sm font-bold uppercase tracking-wider text-muted">Queda poc</h2>
          <ul className="mb-3 space-y-1">
            {low.map((p) => (
              <li key={p.id} className="flex justify-between text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-muted">
                  {formatQuantity(p.quantity, p.unit) || "0"}
                  {listNames.has(p.name.toLowerCase()) && " · a la llista"}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn-secondary w-full" onClick={addLowToList}>
            Afegeix-los a la llista
          </button>
        </section>
      )}
    </div>
  );
}
