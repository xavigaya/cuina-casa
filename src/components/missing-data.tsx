"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Check, Globe, Pencil } from "lucide-react";
import { useHousehold } from "./household";
import { Spinner, toast } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { invalidateFoods } from "@/lib/use-nutrition";
import { HARVARD_GROUPS, type MissingIngredient } from "@/lib/nutrition";
import type { FoodProposal } from "@/lib/food-lookup";

const GROUP_LABEL = Object.fromEntries(HARVARD_GROUPS.map((g) => [g.id, g.label]));
const fmt = (n: number) => n.toLocaleString("ca-ES", { maximumFractionDigits: 1 });

/**
 * Ingredients que no s'han pogut comptar. Per als que no tenen dades, busca valors a
 * Open Food Facts i en fa una proposta que es pot acceptar amb un clic.
 */
export function MissingDataHelper({ missing }: { missing: MissingIngredient[] }) {
  const supabase = supabaseBrowser();
  const { household } = useHousehold();
  const [proposals, setProposals] = useState<Record<string, FoodProposal | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const unique = [...new Map(missing.map((m) => [`${m.name}|${m.in ?? ""}`, m])).values()];
  const noData = [...new Set(unique.filter((m) => m.reason === "sense_dades").map((m) => m.name))];
  if (!unique.length) return null;

  async function lookup() {
    setBusy(true);
    try {
      const res = await fetch("/api/food-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: noData }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const list = json.proposals as (FoodProposal | null)[];
      setProposals(Object.fromEntries(noData.map((n, i) => [n, list[i] ?? null])));
    } catch {
      toast("No s'ha pogut fer la cerca. Torna-ho a provar d'aquí a una estona.");
    }
    setBusy(false);
  }

  async function accept(list: FoodProposal[]) {
    if (!list.length) return;
    setSaving(list.length === 1 ? list[0].name : "*");
    const rows = list.map((p) => ({
      household_id: household.id,
      name: p.name,
      aliases: [],
      kcal: p.kcal,
      carbs: p.carbs,
      protein: p.protein,
      fat: p.fat,
      fiber: p.fiber,
      harvard_group: p.harvard_group,
      source: "openfoodfacts",
    }));
    const { error } = await supabase.from("foods").insert(rows);
    setSaving(null);
    if (error) {
      toast(error.code === "23505" ? "Algun d'aquests aliments ja existeix a casa" : "No s'ha pogut desar");
      return;
    }
    setAccepted((s) => new Set([...s, ...list.map((p) => p.name)]));
    toast(list.length === 1 ? `Desat: ${list[0].name}` : `${list.length} aliments desats`);
    invalidateFoods(); // el càlcul nutricional es refà sol
  }

  const pending = proposals ? (Object.values(proposals).filter((p) => p && !accepted.has(p.name)) as FoodProposal[]) : [];

  return (
    <div className="rounded-xl bg-saffron-soft p-3 text-sm">
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="size-4 text-saffron" /> Càlcul incomplet
      </p>
      <p className="mb-2 text-xs text-muted">Aquests ingredients no s'han pogut comptar:</p>
      <ul className="mb-3 flex flex-wrap gap-1.5">
        {unique.map((m) => (
          <li key={`${m.name}|${m.in ?? ""}`}>
            <Link
              href={`/aliments?nom=${encodeURIComponent(m.name)}${m.reason === "sense_pes" ? "&pes=1" : ""}`}
              className="inline-block rounded-full bg-card px-2.5 py-1 text-xs font-semibold ring-1 ring-line"
            >
              {m.name}
              {m.in && <span className="font-normal text-muted"> ({m.in})</span>}
              <span className="font-normal text-muted"> · {m.reason === "sense_pes" ? "falta el pes per unitat" : "sense dades"}</span>
            </Link>
          </li>
        ))}
      </ul>

      {noData.length > 0 && !proposals && (
        <button className="btn-secondary w-full !min-h-0 !py-2 text-sm" onClick={lookup} disabled={busy}>
          {busy ? <Spinner className="!size-4" /> : <Globe className="size-4" />}
          {busy ? "Buscant valors…" : noData.length === 1 ? "Busca'n els valors a Internet" : `Busca els valors dels ${noData.length} ingredients a Internet`}
        </button>
      )}

      {proposals && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Propostes (per 100 g)</p>
          {noData.map((name) => {
            const p = proposals[name];
            const done = accepted.has(name);
            return (
              <div key={name} className="rounded-xl bg-card p-3">
                <p className="font-semibold first-letter:uppercase">{name}</p>
                {p ? (
                  <>
                    <p className="mt-0.5 tabular-nums">
                      ≈ {fmt(p.kcal)} kcal · HC {fmt(p.carbs)} g · Prot. {fmt(p.protein)} g · Greix {fmt(p.fat)} g · Fibra {fmt(p.fiber)} g
                    </p>
                    <p className="text-xs text-muted">
                      {GROUP_LABEL[p.harvard_group]} · mitjana de {p.samples} {p.samples === 1 ? "producte" : "productes"} d'Open Food Facts
                      {p.examples.length > 0 && ` (p. ex. ${p.examples.slice(0, 2).join(", ")})`}
                    </p>
                    <div className="mt-2 flex gap-2">
                      {done ? (
                        <span className="flex items-center gap-1 text-xs font-bold text-herb">
                          <Check className="size-4" /> Desat
                        </span>
                      ) : (
                        <>
                          <button className="rounded-full bg-herb px-3 py-1 text-xs font-bold text-paper" onClick={() => accept([p])} disabled={saving !== null}>
                            {saving === name ? "Desant…" : "Accepta"}
                          </button>
                          <Link href={`/aliments?nom=${encodeURIComponent(name)}`} className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-muted">
                            <Pencil className="size-3" /> Escriu-los tu
                          </Link>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="mt-0.5 text-xs text-muted">
                    No s'ha trobat res semblant.{" "}
                    <Link href={`/aliments?nom=${encodeURIComponent(name)}`} className="font-semibold text-tomato underline">
                      Afegeix-ne les dades
                    </Link>{" "}
                    o comprova que el nom de l'ingredient sigui correcte.
                  </p>
                )}
              </div>
            );
          })}
          {pending.length > 1 && (
            <button className="btn-primary w-full !min-h-0 !py-2 text-sm" onClick={() => accept(pending)} disabled={saving !== null}>
              <Check className="size-4" /> {saving === "*" ? "Desant…" : `Accepta-les totes (${pending.length})`}
            </button>
          )}
          <p className="text-[11px] text-muted">Valors orientatius de productes comercials. Revisa'ls si l'ingredient és molt diferent.</p>
        </div>
      )}
    </div>
  );
}
