"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Merge, X } from "lucide-react";
import { useHousehold, usePermissions } from "@/components/household";
import { EmptyState, PageHeader, Spinner, toast } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { buildFoodIndex } from "@/lib/nutrition";
import { invalidateFoods, loadFoods } from "@/lib/use-nutrition";
import { findSimilarNames, type NameUse, type RefTable, type UnifyProposal } from "@/lib/ingredient-unify";

const REASON: Record<UnifyProposal["reason"], string> = {
  grafia: "El mateix nom escrit diferent",
  variant: "Semblen el mateix producte",
  errata: "Possible errata",
};

const IGNORE_KEY = (h: string) => `cuina-casa:unificar-ignorats:${h}`;

function readIgnored(h: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(IGNORE_KEY(h)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export default function UnifyPage() {
  const supabase = supabaseBrowser();
  const { household } = useHousehold();
  const { privileged } = usePermissions();
  const [proposals, setProposals] = useState<UnifyProposal[] | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [recipesRes, pantryRes, listRes, foods] = await Promise.all([
      supabase.from("recipes").select("title, recipe_ingredients!recipe_ingredients_recipe_id_fkey(id, name)").eq("household_id", household.id),
      supabase.from("pantry_items").select("id, name").eq("household_id", household.id),
      supabase.from("shopping_items").select("id, name").eq("household_id", household.id).eq("checked", false),
      loadFoods(household.id).catch(() => null),
    ]);
    const uses: NameUse[] = [];
    type R = { title: string; recipe_ingredients: { id: string; name: string }[] };
    for (const r of (recipesRes.data as R[]) ?? []) {
      for (const i of r.recipe_ingredients ?? []) uses.push({ name: i.name, recipes: [r.title], refs: [{ table: "recipe_ingredients", id: i.id }] });
    }
    for (const p of (pantryRes.data as { id: string; name: string }[]) ?? []) uses.push({ name: p.name, recipes: [], refs: [{ table: "pantry_items", id: p.id }] });
    for (const s of (listRes.data as { id: string; name: string }[]) ?? []) uses.push({ name: s.name, recipes: [], refs: [{ table: "shopping_items", id: s.id }] });
    setProposals(findSimilarNames(uses, foods ? buildFoodIndex(foods) : null));
  }, [supabase, household.id]);

  useEffect(() => {
    setIgnored(readIgnored(household.id));
    load();
  }, [household.id, load]);

  const visible = useMemo(() => (proposals ?? []).filter((p) => !ignored.has(p.id)), [proposals, ignored]);

  function ignore(p: UnifyProposal) {
    const next = new Set(ignored).add(p.id);
    setIgnored(next);
    try {
      localStorage.setItem(IGNORE_KEY(household.id), JSON.stringify([...next]));
    } catch {}
  }

  async function unify(target: string, members: UnifyProposal["members"]) {
    const byTable = new Map<RefTable, string[]>();
    for (const m of members) {
      if (m.name === target) continue;
      for (const r of m.refs) byTable.set(r.table, [...(byTable.get(r.table) ?? []), r.id]);
    }
    const results = await Promise.all([...byTable].map(([table, ids]) => supabase.from(table).update({ name: target }).in("id", ids)));
    if (results.some((r) => r.error)) {
      toast("No s'ha pogut unificar del tot");
    } else {
      const n = members.filter((m) => m.name !== target).length;
      toast(n === 1 ? `Unificat com a «${target}»` : `${n} noms unificats com a «${target}»`);
    }
    invalidateFoods(); // les pantalles obertes refan càlculs i llistes
    load();
  }

  return (
    <>
      <Link href="/aliments" className="btn-ghost -ml-3 mb-2 !px-3">
        <ArrowLeft className="size-5" /> Aliments
      </Link>
      <PageHeader title="Ingredients semblants" subtitle="Noms que semblen el mateix producte en receptes, rebost i llista." />

      {!privileged ? (
        <EmptyState emoji="🔒" title="Només per a persones privilegiades">
          Unificar noms canvia receptes de tota la família, així que només ho pot fer una persona amb tots els permisos.
        </EmptyState>
      ) : !proposals ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState emoji="✨" title="Tot en ordre">
          No hi ha ingredients amb noms semblants per unificar.
        </EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            Unificar-los fa que a la llista de la compra se sumin en un sol producte i que el rebost els reconegui. Tria quin nom es queda i quins
            hi entren; la resta no es tocarà.
          </p>
          <ul className="space-y-4">
            {visible.map((p) => (
              <ProposalCard key={p.id} proposal={p} onUnify={unify} onIgnore={() => ignore(p)} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function ProposalCard({
  proposal,
  onUnify,
  onIgnore,
}: {
  proposal: UnifyProposal;
  onUnify: (target: string, members: UnifyProposal["members"]) => Promise<void>;
  onIgnore: () => void;
}) {
  const [target, setTarget] = useState(proposal.target);
  const [included, setIncluded] = useState<Set<string>>(new Set(proposal.members.map((m) => m.name)));
  const [busy, setBusy] = useState(false);
  const chosen = proposal.members.filter((m) => included.has(m.name) || m.name === target);
  const changes = chosen.filter((m) => m.name !== target);

  return (
    <li className="card space-y-3 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{REASON[proposal.reason]}</p>
      <ul className="space-y-2">
        {proposal.members.map((m) => {
          const isTarget = m.name === target;
          const on = isTarget || included.has(m.name);
          const where = [
            m.recipes.length ? (m.recipes.length === 1 ? `a «${m.recipes[0]}»` : `a ${m.recipes.length} receptes`) : null,
            m.refs.some((r) => r.table === "pantry_items") ? "al rebost" : null,
            m.refs.some((r) => r.table === "shopping_items") ? "a la llista" : null,
          ].filter(Boolean);
          return (
            <li key={m.name} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${isTarget ? "bg-herb-soft" : on ? "bg-paper" : "opacity-50"}`}>
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-[var(--color-herb)]"
                checked={on}
                disabled={isTarget}
                onChange={(e) => {
                  const next = new Set(included);
                  if (e.target.checked) next.add(m.name);
                  else next.delete(m.name);
                  setIncluded(next);
                }}
                aria-label={`Inclou «${m.name}»`}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold first-letter:uppercase">{m.name}</span>
                <span className="block truncate text-xs text-muted">{where.join(" · ")}</span>
              </span>
              {isTarget ? (
                <span className="shrink-0 text-[11px] font-bold uppercase text-herb">Es queda</span>
              ) : (
                <button
                  className="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold text-muted ring-1 ring-line"
                  onClick={() => {
                    setTarget(m.name);
                    setIncluded((s) => new Set(s).add(m.name));
                  }}
                >
                  Tria aquest
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <button className="btn-secondary !min-h-0 !py-2 text-sm" onClick={onIgnore}>
          <X className="size-4" /> No són el mateix
        </button>
        <button
          className="btn-primary !min-h-0 flex-1 !py-2 text-sm"
          disabled={busy || changes.length === 0}
          onClick={async () => {
            setBusy(true);
            await onUnify(target, chosen);
            setBusy(false);
          }}
        >
          {busy ? <Spinner className="!size-4 !border-white/40 !border-t-white" /> : changes.length ? <Merge className="size-4" /> : <Check className="size-4" />}
          {changes.length ? `Unifica com a «${target}»` : "Res a unificar"}
        </button>
      </div>
    </li>
  );
}
