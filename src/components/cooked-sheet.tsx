"use client";

import { useEffect, useState } from "react";
import { Check, PackageMinus, ShoppingCart } from "lucide-react";
import { useHousehold } from "./household";
import { Sheet, Spinner, toast } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { loadRecipeGraph } from "@/lib/plan-actions";
import { loadFoods } from "@/lib/use-nutrition";
import { buildFoodIndex } from "@/lib/nutrition";
import { expandUses, planCooking, type CookPlan } from "@/lib/cooking";
import { ingredientKey } from "@/lib/ingredients";
import { undoLatestFor } from "@/lib/proposals";
import { formatQuantity, normalizeUnit, unitLabel } from "@/lib/units";
import { LOCATIONS, type PantryItem } from "@/lib/types";
import { parseQty, qtyToString } from "./fields";

interface RowState {
  on: boolean;
  after: string;
  remove: boolean;
  toList: boolean;
}

/**
 * «L'he cuinada»: proposa què es gasta del rebost i, en confirmar-ho,
 * l'actualitza d'una sola vegada (es pot desfer).
 */
export function CookedSheet({
  open,
  onClose,
  recipeId,
  servings,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  recipeId: string;
  servings: number;
  onDone?: () => void;
}) {
  const supabase = supabaseBrowser();
  const { household } = useHousehold();
  const [plan, setPlan] = useState<CookPlan | null>(null);
  const [items, setItems] = useState<Map<string, PantryItem>>(new Map());
  const [state, setState] = useState<Record<string, RowState>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlan(null);
    setError(null);
    (async () => {
      try {
        const [graph, pantryRes, listRes, foods] = await Promise.all([
          loadRecipeGraph(household.id),
          supabase.from("pantry_items").select("*").eq("household_id", household.id),
          supabase.from("shopping_items").select("name").eq("household_id", household.id).eq("checked", false),
          loadFoods(household.id).catch(() => null),
        ]);
        const pantry = (pantryRes.data as PantryItem[]) ?? [];
        const onList = new Set(((listRes.data as { name: string }[]) ?? []).map((i) => ingredientKey(i.name)));
        const uses = expandUses(recipeId, servings, graph, pantry, household.servings);
        const p = planCooking(uses, pantry, foods ? buildFoodIndex(foods) : null);
        const st: Record<string, RowState> = {};
        for (const d of p.deductions) {
          const empty = d.after != null && d.after <= 0;
          const low = d.item.min_quantity != null && d.after != null && d.after < Number(d.item.min_quantity);
          st[d.item.id] = {
            on: d.sure,
            after: d.after == null ? "" : qtyToString(d.after),
            remove: d.sure && empty,
            toList: d.sure && (empty || low) && !onList.has(ingredientKey(d.item.name)),
          };
        }
        setItems(new Map(pantry.map((i) => [i.id, i])));
        setState(st);
        setPlan(p);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [open, recipeId, servings, household.id, household.servings, supabase]);

  const set = (id: string, patch: Partial<RowState>) => setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const chosen = plan?.deductions.filter((d) => state[d.item.id]?.on) ?? [];

  async function save() {
    if (!plan) return;
    setSaving(true);
    const updates: PantryItem[] = [];
    const removals: string[] = [];
    const toList: PantryItem[] = [];
    for (const d of chosen) {
      const s = state[d.item.id];
      const item = items.get(d.item.id)!;
      if (s.toList) toList.push(item);
      if (s.remove) {
        removals.push(item.id);
        continue;
      }
      const qty = parseQty(s.after);
      if (qty !== (item.quantity == null ? null : Number(item.quantity))) updates.push({ ...item, quantity: qty });
    }
    // Una sola petició per a cada tipus de canvi: al registre surten agrupats
    const results = await Promise.all([
      updates.length ? supabase.from("pantry_items").upsert(updates) : null,
      removals.length ? supabase.from("pantry_items").delete().in("id", removals) : null,
      toList.length
        ? supabase
            .from("shopping_items")
            .insert(toList.map((i) => ({ household_id: household.id, name: i.name, section: i.section, unit: i.unit, source: "rebost" })))
            .select("id")
        : null,
    ]);
    setSaving(false);
    if (results.some((r) => r?.error)) {
      toast("No s'ha pogut actualitzar tot el rebost");
      return;
    }
    const listIds = ((results[2]?.data as { id: string }[] | null) ?? []).map((r) => r.id);
    const touched = [...updates.map((u) => u.id), ...removals];
    onClose();
    onDone?.();
    if (!touched.length && !listIds.length) {
      toast("Bon profit! 🍽️");
      return;
    }
    toast(
      `Rebost actualitzat (${touched.length})${listIds.length ? ` · ${listIds.length} a la llista` : ""}`,
      {
        label: "Desfés",
        run: async () => {
          const err = (await undoLatestFor("pantry_items", touched)) ?? (await undoLatestFor("shopping_items", listIds));
          toast(err ?? "Rebost com abans");
        },
      },
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="L'he cuinada">
      {error ? (
        <p className="rounded-xl bg-tomato-soft p-3 text-sm text-tomato">{error}</p>
      ) : !plan ? (
        <div className="grid place-items-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Per a {servings} {servings === 1 ? "ració" : "racions"}. Revisa què queda al rebost; el que no marquis no es tocarà.
          </p>

          {plan.deductions.length === 0 ? (
            <p className="rounded-2xl bg-paper p-4 text-center text-sm text-muted">Cap ingredient d'aquesta recepta no és al rebost: no hi ha res a descomptar.</p>
          ) : (
            <ul className="space-y-2">
              {plan.deductions.map((d) => {
                const s = state[d.item.id];
                const unit = normalizeUnit(d.item.unit);
                const unitText = d.item.unit ? (unit === "u" ? "u" : unitLabel(unit ?? d.item.unit, Number(parseQty(s.after) ?? 0))) : "";
                return (
                  <li key={d.item.id} className={`rounded-2xl p-3 ring-1 ring-line ${s.on ? "bg-card" : "bg-paper opacity-70"}`}>
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-5 shrink-0 accent-[var(--color-herb)]"
                        checked={s.on}
                        onChange={(e) => set(d.item.id, { on: e.target.checked })}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold first-letter:uppercase">{d.item.name}</span>
                        <span className="block text-xs text-muted">
                          {LOCATIONS.find((l) => l.id === d.item.location)?.label} · tenies {formatQuantity(d.item.quantity, d.item.unit) || "una quantitat sense indicar"}
                          {d.used ? ` · se'n gasta ${d.used}` : ""}
                        </span>
                        {!d.sure && (
                          <span className="mt-0.5 block text-xs font-semibold text-saffron">
                            {d.item.quantity == null ? "No se sap quant n'hi havia: indica'n el que queda." : "No es pot calcular amb aquestes unitats: indica'n el que queda."}
                          </span>
                        )}
                      </span>
                    </label>
                    {s.on && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                        {!s.remove && (
                          <label className="flex items-center gap-2 text-sm">
                            Queda
                            <input
                              className="input !w-24 !py-1.5"
                              inputMode="decimal"
                              value={s.after}
                              onChange={(e) => set(d.item.id, { after: e.target.value })}
                              aria-label={`Quantitat que queda de ${d.item.name}`}
                            />
                            <span className="text-muted">{unitText}</span>
                          </label>
                        )}
                        <button
                          type="button"
                          className="chip !py-1 text-xs"
                          data-active={s.remove}
                          onClick={() => set(d.item.id, { remove: !s.remove })}
                        >
                          <PackageMinus className="size-3.5" /> S'ha acabat
                        </button>
                        <button
                          type="button"
                          className="chip !py-1 text-xs"
                          data-active={s.toList}
                          onClick={() => set(d.item.id, { toList: !s.toList })}
                        >
                          <ShoppingCart className="size-3.5" /> A la llista
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {plan.notAtHome.length > 0 && (
            <p className="text-xs text-muted">
              <span className="font-semibold">No eren al rebost:</span> {plan.notAtHome.join(", ")}.
            </p>
          )}
          {plan.vague.length > 0 && (
            <p className="text-xs text-muted">
              <span className="font-semibold">Sense quantitat (no es descompten):</span> {plan.vague.join(", ")}.
            </p>
          )}

          <button className="btn-primary w-full" onClick={save} disabled={saving}>
            {saving ? <Spinner className="!size-4 !border-white/40 !border-t-white" /> : <Check className="size-4" />}
            {chosen.length ? `Actualitza el rebost (${chosen.length})` : "Fet, sense tocar el rebost"}
          </button>
        </div>
      )}
    </Sheet>
  );
}
