"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Ban } from "lucide-react";
import { useHousehold } from "./household";
import { loadRecipeGraph, type GraphRecipe } from "@/lib/plan-actions";
import { findConflicts, recipeIngredientNames, type DietConflict } from "@/lib/diet";

/** Comprova receptes contra les al·lèrgies i preferències de la família */
export function useDietCheck() {
  const { household, members } = useHousehold();
  const [graph, setGraph] = useState<Map<string, GraphRecipe> | null>(null);
  const hasPrefs = members.some((m) => (m.allergies?.length ?? 0) + (m.avoid?.length ?? 0) > 0);

  const reload = useCallback(() => {
    if (!hasPrefs) return;
    loadRecipeGraph(household.id)
      .then(setGraph)
      .catch(() => {});
  }, [household.id, hasPrefs]);

  useEffect(() => {
    reload();
  }, [reload]);

  const cache = useMemo(() => new Map<string, DietConflict[]>(), [graph, members]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflictsFor = useCallback(
    (recipeId: string | null | undefined): DietConflict[] => {
      if (!recipeId || !graph || !hasPrefs) return [];
      if (!cache.has(recipeId)) cache.set(recipeId, findConflicts(recipeIngredientNames(recipeId, graph), members));
      return cache.get(recipeId)!;
    },
    [graph, members, hasPrefs, cache],
  );
  return { conflictsFor, hasPrefs, reload };
}

/** Avís a la fitxa d'una recepta */
export function DietWarnings({ conflicts }: { conflicts: DietConflict[] }) {
  if (!conflicts.length) return null;
  const allergies = conflicts.filter((c) => c.kind === "allergia");
  const dislikes = conflicts.filter((c) => c.kind === "no_menja");
  return (
    <div className={`mt-4 space-y-1.5 rounded-2xl border-2 p-3 text-sm ${allergies.length ? "border-tomato/60 bg-tomato-soft/60" : "border-line bg-paper"}`}>
      {allergies.map((c) => (
        <p key={`${c.userId}-${c.item}`} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-tomato" />
          <span>
            <span className="font-semibold">{c.person}</span>: al·lèrgia a {c.label.toLowerCase()} — {c.ingredients.join(", ")}
          </span>
        </p>
      ))}
      {dislikes.map((c) => (
        <p key={`${c.userId}-${c.item}`} className="flex items-start gap-2 text-muted">
          <Ban className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold text-ink">{c.person}</span> no menja {c.label}
            {c.ingredients.some((i) => i.toLowerCase() !== c.label.toLowerCase()) ? ` (${c.ingredients.join(", ")})` : ""}
          </span>
        </p>
      ))}
      {allergies.length > 0 && <p className="text-xs text-muted">Avís orientatiu a partir dels noms dels ingredients: reviseu sempre les etiquetes.</p>}
    </div>
  );
}

/** Icona petita per al menú i els llistats */
export function DietBadge({ conflicts }: { conflicts: DietConflict[] }) {
  if (!conflicts.length) return null;
  const allergy = conflicts.some((c) => c.kind === "allergia");
  const title = conflicts
    .map((c) => (c.kind === "allergia" ? `${c.person}: al·lèrgia a ${c.label.toLowerCase()}` : `${c.person} no menja ${c.label}`))
    .join("\n");
  return (
    <span className={`inline-flex shrink-0 items-center ${allergy ? "text-tomato" : "text-muted"}`} title={title} aria-label={title}>
      {allergy ? <AlertTriangle className="size-4" /> : <Ban className="size-4" />}
    </span>
  );
}
