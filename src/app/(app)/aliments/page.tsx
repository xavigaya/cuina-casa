"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Merge, Plus, Search, Trash2 } from "lucide-react";
import { useHousehold } from "@/components/household";
import { Disclaimer } from "@/components/nutrition";
import { PageHeader, Sheet, Spinner, toast } from "@/components/ui";
import { parseQty, qtyToString } from "@/components/fields";
import { supabaseBrowser } from "@/lib/supabase/client";
import { HARVARD_GROUPS, buildFoodIndex, matchFood, type Food, type HarvardGroup } from "@/lib/nutrition";
import { normalizeText } from "@/lib/sections";
import { guessGroupFromName } from "@/lib/off";
import { invalidateFoods, loadFoods } from "@/lib/use-nutrition";

const GROUP_LABEL = Object.fromEntries(HARVARD_GROUPS.map((g) => [g.id, g.label])) as Record<HarvardGroup, string>;

const guessGroup = guessGroupFromName;

type Draft = Partial<Food> & { name: string };

export default function FoodsPage() {
  const supabase = supabaseBrowser();
  const { household } = useHousehold();
  const [foods, setFoods] = useState<Food[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyOwn, setOnlyOwn] = useState(false);
  const [editing, setEditing] = useState<{ draft: Draft; focusWeight?: boolean } | null>(null);

  const refresh = async (force = false) => {
    try {
      setFoods(await loadFoods(household.id, force));
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(err.code === "42P01" || err.code === "PGRST205" ? "falta_migracio" : err.message ?? "error");
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household.id]);

  // Si venim d'un ingredient sense dades (?nom=…), obrim el formulari directament
  useEffect(() => {
    if (!foods) return;
    const params = new URLSearchParams(window.location.search);
    const name = params.get("nom");
    if (!name) return;
    window.history.replaceState(null, "", "/aliments");
    const match = matchFood(buildFoodIndex(foods), name);
    if (match) setEditing({ draft: match, focusWeight: params.get("pes") === "1" });
    else setEditing({ draft: { name, harvard_group: guessGroup(name), aliases: [] } });
  }, [foods]);

  const visible = useMemo(() => {
    if (!foods) return [];
    const q = normalizeText(query);
    // Si la llar té una còpia pròpia d'un aliment de referència, només es mostra la pròpia
    const ownNames = new Set(foods.filter((f) => f.household_id).map((f) => f.name.toLowerCase()));
    return foods.filter(
      (f) =>
        (!onlyOwn || f.household_id) &&
        (f.household_id || !ownNames.has(f.name.toLowerCase())) &&
        (!q || normalizeText(f.name).includes(q) || f.aliases?.some((a) => normalizeText(a).includes(q))),
    );
  }, [foods, query, onlyOwn]);

  async function save(draft: Draft) {
    const row = {
      name: draft.name.trim(),
      aliases: draft.aliases ?? [],
      kcal: draft.kcal ?? 0,
      carbs: draft.carbs ?? 0,
      protein: draft.protein ?? 0,
      fat: draft.fat ?? 0,
      fiber: draft.fiber ?? 0,
      harvard_group: draft.harvard_group ?? "condiment",
      unit_g: draft.unit_g ?? null,
      pack_g: draft.pack_g ?? null,
      density: draft.density && draft.density > 0 ? draft.density : 1,
      plate_factor: draft.plate_factor && draft.plate_factor > 0 ? draft.plate_factor : 1,
    };
    const { error } =
      draft.id && draft.household_id
        ? await supabase.from("foods").update(row).eq("id", draft.id)
        : await supabase.from("foods").insert({ ...row, household_id: household.id, source: draft.source === "openfoodfacts" ? "openfoodfacts" : "manual" });
    if (error) {
      toast(error.code === "23505" ? "Ja hi ha un aliment propi amb aquest nom" : "No s'ha pogut desar");
      return;
    }
    setEditing(null);
    toast("Aliment desat");
    invalidateFoods();
    refresh(true);
  }

  async function remove(food: Food) {
    if (!food.household_id) return;
    const { error } = await supabase.from("foods").delete().eq("id", food.id);
    if (error) return toast("No s'ha pogut esborrar");
    setEditing(null);
    toast(`Esborrat: ${food.name}`);
    invalidateFoods();
    refresh(true);
  }

  return (
    <>
      <PageHeader
        title="Aliments"
        subtitle="Valors nutricionals per 100 g"
        action={
          <button className="btn-primary !px-3" onClick={() => setEditing({ draft: { name: "", harvard_group: "verdura", aliases: [] } })} aria-label="Afegeix un aliment">
            <Plus className="size-5" />
          </button>
        }
      />

      {error === "falta_migracio" ? (
        <p className="card p-4 text-sm text-muted">
          Cal executar la migració <code className="font-mono">0003_dades_nutricionals.sql</code> a Supabase per fer servir els aliments.
        </p>
      ) : !foods ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          <Link href="/aliments/unificar" className="card mb-4 flex items-center gap-3 p-4">
            <Merge className="size-5 shrink-0 text-herb" />
            <span className="flex-1">
              <span className="block font-semibold">Unifica ingredients semblants</span>
              <span className="text-xs text-muted">Troba noms que són el mateix producte («ceba» i «ceba dolça», «fulles de julivert»…)</span>
            </span>
            <ChevronRight className="size-5 text-muted" />
          </Link>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input className="input !rounded-full !pl-10" placeholder="Busca un aliment…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="mb-4 flex gap-2">
            <button className="chip" data-active={!onlyOwn} onClick={() => setOnlyOwn(false)}>
              Tots ({foods.length})
            </button>
            <button className="chip" data-active={onlyOwn} onClick={() => setOnlyOwn(true)}>
              De casa ({foods.filter((f) => f.household_id).length})
            </button>
          </div>
          <ul className="card divide-y divide-line overflow-hidden">
            {visible.slice(0, 300).map((f) => (
              <li key={f.id}>
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left" onClick={() => setEditing({ draft: f })}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium first-letter:uppercase">{f.name}</span>
                    <span className="text-xs text-muted">
                      {GROUP_LABEL[f.harvard_group]}
                      {f.household_id && (f.source === "openfoodfacts" ? " · Open Food Facts" : " · de casa")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted">
                    <span className="block text-sm font-semibold text-ink">{Math.round(f.kcal)} kcal</span>
                    HC {f.carbs} · P {f.protein} · G {f.fat}
                  </span>
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted">
                No hi ha cap aliment amb aquest nom.{" "}
                <button className="font-semibold text-tomato" onClick={() => setEditing({ draft: { name: query, harvard_group: guessGroup(query), aliases: [] } })}>
                  Afegeix-lo
                </button>
              </li>
            )}
          </ul>
          <Disclaimer className="mt-4" />
        </>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.draft.id ? "Edita l'aliment" : "Aliment nou"}>
        {editing && (
          <FoodForm
            key={editing.draft.id ?? editing.draft.name}
            draft={editing.draft}
            focusWeight={editing.focusWeight}
            onSave={save}
            onDelete={editing.draft.household_id ? () => remove(editing.draft as Food) : undefined}
          />
        )}
      </Sheet>
    </>
  );
}

function NumberField({ id, label, value, onChange, suffix }: { id: string; label: string; value: number | null | undefined; onChange: (v: number | null) => void; suffix?: string }) {
  const [text, setText] = useState(qtyToString(value ?? null));
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className="input pr-10"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d.,]/g, "");
            setText(t);
            onChange(parseQty(t));
          }}
          placeholder="—"
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">{suffix}</span>}
      </div>
    </div>
  );
}

function FoodForm({ draft: initial, focusWeight, onSave, onDelete }: { draft: Draft; focusWeight?: boolean; onSave: (d: Draft) => void; onDelete?: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [aliasText, setAliasText] = useState((initial.aliases ?? []).join(", "));
  const isReference = !!initial.id && !initial.household_id;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!d.name.trim()) return;
        onSave({
          ...d,
          aliases: aliasText.split(",").map((a) => a.trim()).filter(Boolean),
          // En editar un aliment de referència, se'n desa una còpia pròpia de la llar
          ...(isReference ? { id: undefined, household_id: null } : {}),
        });
      }}
    >
      {isReference && (
        <p className="rounded-xl bg-paper p-3 text-sm text-muted">És un aliment de referència. Si el canvies, se'n desarà una còpia per a la vostra llar, que tindrà prioritat.</p>
      )}
      {focusWeight && <p className="rounded-xl bg-saffron-soft p-3 text-sm">Indica quant pesa una unitat perquè es pugui calcular «2 unitats», «1 peça»…</p>}
      <div>
        <label className="label" htmlFor="f-nom">
          Nom
        </label>
        <input id="f-nom" className="input" value={d.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} autoFocus={!initial.id} />
      </div>
      <div>
        <label className="label" htmlFor="f-alies">
          Altres noms · separats per comes
        </label>
        <input id="f-alies" className="input" value={aliasText} onChange={(e) => setAliasText(e.target.value)} placeholder="p. ex. tomate, tomàquet de pera" />
      </div>
      <div>
        <label className="label" htmlFor="f-grup">
          Grup (Plat de Harvard)
        </label>
        <select id="f-grup" className="input" value={d.harvard_group ?? "condiment"} onChange={(e) => set("harvard_group", e.target.value as HarvardGroup)}>
          {HARVARD_GROUPS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="label">Per 100 g (com a l'etiqueta)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField id="f-kcal" label="Energia" value={d.kcal} onChange={(v) => set("kcal", v ?? 0)} suffix="kcal" />
          <NumberField id="f-hc" label="Carbohidrats" value={d.carbs} onChange={(v) => set("carbs", v ?? 0)} suffix="g" />
          <NumberField id="f-p" label="Proteïnes" value={d.protein} onChange={(v) => set("protein", v ?? 0)} suffix="g" />
          <NumberField id="f-g" label="Greixos" value={d.fat} onChange={(v) => set("fat", v ?? 0)} suffix="g" />
          <NumberField id="f-fib" label="Fibra" value={d.fiber} onChange={(v) => set("fiber", v ?? 0)} suffix="g" />
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Pesos per convertir unitats</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumberField id="f-unit" label="1 unitat pesa" value={d.unit_g} onChange={(v) => set("unit_g", v)} suffix="g" />
          <NumberField id="f-pack" label="1 llauna/pot/paquet" value={d.pack_g} onChange={(v) => set("pack_g", v)} suffix="g" />
          <NumberField id="f-dens" label="Densitat (g per ml)" value={d.density ?? 1} onChange={(v) => set("density", v ?? 1)} />
        </div>
      </fieldset>
      <div className="flex gap-2 pt-1">
        {onDelete && (
          <button type="button" className="btn-secondary !text-tomato" onClick={onDelete} aria-label="Esborra">
            <Trash2 className="size-4" />
          </button>
        )}
        <button className="btn-primary flex-1">{isReference ? "Desa una còpia per a casa" : "Desa"}</button>
      </div>
    </form>
  );
}
