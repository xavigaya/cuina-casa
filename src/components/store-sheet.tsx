"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Store as StoreIcon, Trash2 } from "lucide-react";
import { useHousehold, usePermissions } from "./household";
import { Sheet, Spinner, toast } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { canModify } from "@/lib/permissions";
import { undoLatestFor } from "@/lib/proposals";
import { sectionInfo } from "@/lib/sections";
import { fullSectionOrder, moveSection, type Store } from "@/lib/shopping-plus";

const STORE_KEY = (h: string) => `cuina-casa:super:${h}`;

/** El súper triat en aquest mòbil (cadascú pot ser en un súper diferent) */
export function useSelectedStore(householdId: string) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setId(localStorage.getItem(STORE_KEY(householdId)));
    } catch {}
  }, [householdId]);
  const choose = (next: string | null) => {
    setId(next);
    try {
      if (next) localStorage.setItem(STORE_KEY(householdId), next);
      else localStorage.removeItem(STORE_KEY(householdId));
    } catch {}
  };
  return [id, choose] as const;
}

/**
 * Triar en quin supermercat ets (la llista s'ordena com el recorres) i
 * definir l'ordre de les seccions de cadascun.
 */
export function StoreSheet({
  open,
  onClose,
  stores,
  selected,
  onSelect,
  onChanged,
  missing,
}: {
  open: boolean;
  onClose: () => void;
  stores: Store[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
  missing: boolean;
}) {
  const supabase = supabaseBrowser();
  const { household } = useHousehold();
  const perms = usePermissions();
  const [editing, setEditing] = useState<{ id: string | null; name: string; order: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setEditing(null);
  }, [open]);

  async function save() {
    if (!editing || !editing.name.trim()) return;
    setBusy(true);
    const row = { name: editing.name.trim(), section_order: fullSectionOrder(editing.order) };
    const res = editing.id
      ? await supabase.from("stores").update(row).eq("id", editing.id).select("id").single()
      : await supabase.from("stores").insert({ ...row, household_id: household.id, created_by: perms.userId }).select("id").single();
    setBusy(false);
    if (res.error) {
      toast("No s'ha pogut desar el supermercat");
      return;
    }
    onSelect((res.data as { id: string }).id);
    setEditing(null);
    onChanged();
    toast("Supermercat desat");
  }

  async function remove(s: Store) {
    if (!confirm(`Esborres «${s.name}» i el seu ordre de seccions?`)) return;
    const { error } = await supabase.from("stores").delete().eq("id", s.id);
    if (error) return toast("No s'ha pogut esborrar");
    if (selected === s.id) onSelect(null);
    setEditing(null);
    onChanged();
    toast("Supermercat esborrat", {
      label: "Desfés",
      run: async () => {
        toast((await undoLatestFor("stores", [s.id])) ?? "Recuperat");
        onChanged();
      },
    });
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? (editing.id ? "Ordre del supermercat" : "Supermercat nou") : "On compres?"}>
      {missing ? (
        <p className="rounded-xl bg-saffron-soft p-3 text-sm">
          Per ordenar la llista per supermercat cal executar la migració <code>0007_supermercats_i_preus.sql</code> a Supabase.
        </p>
      ) : editing ? (
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="super-nom">
              Nom
            </label>
            <input
              id="super-nom"
              className="input"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Bonpreu, Mercadona, el mercat…"
              maxLength={60}
              autoFocus={!editing.id}
            />
          </div>
          <div>
            <p className="label">Ordre de les seccions, tal com el recorres</p>
            <ol className="card divide-y divide-line">
              {fullSectionOrder(editing.order).map((id, i, all) => {
                const s = sectionInfo(id);
                return (
                  <li key={id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="w-5 text-right text-xs font-semibold text-muted">{i + 1}</span>
                    <span className="flex-1 text-sm">
                      {s.emoji} {s.label}
                    </span>
                    <button
                      className="grid size-9 place-items-center rounded-full text-muted disabled:opacity-30"
                      disabled={i === 0}
                      onClick={() => setEditing({ ...editing, order: moveSection(editing.order, id, -1) })}
                      aria-label={`Puja ${s.label}`}
                    >
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      className="grid size-9 place-items-center rounded-full text-muted disabled:opacity-30"
                      disabled={i === all.length - 1}
                      onClick={() => setEditing({ ...editing, order: moveSection(editing.order, id, 1) })}
                      aria-label={`Baixa ${s.label}`}
                    >
                      <ArrowDown className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setEditing(null)}>
              Enrere
            </button>
            <button className="btn-primary flex-1" onClick={save} disabled={busy || !editing.name.trim()}>
              {busy ? <Spinner className="!size-4 !border-white/40 !border-t-white" /> : <Check className="size-4" />} Desa
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">La llista s&apos;ordena com recorres el súper que triïs. Cada mòbil recorda el seu.</p>
          <ul className="space-y-2">
            <li>
              <button
                className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 ${selected ? "bg-card ring-line" : "bg-herb-soft ring-herb"}`}
                onClick={() => {
                  onSelect(null);
                  onClose();
                }}
              >
                <StoreIcon className="size-5 text-muted" />
                <span className="flex-1 font-medium">Ordre habitual</span>
                {!selected && <Check className="size-5 text-herb" />}
              </button>
            </li>
            {stores.map((s) => (
              <li key={s.id} className={`flex items-center gap-1 rounded-2xl ring-1 ${selected === s.id ? "bg-herb-soft ring-herb" : "bg-card ring-line"}`}>
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                  onClick={() => {
                    onSelect(s.id);
                    onClose();
                  }}
                >
                  <StoreIcon className="size-5 shrink-0 text-muted" />
                  <span className="flex-1 truncate font-medium">{s.name}</span>
                  {selected === s.id && <Check className="size-5 text-herb" />}
                </button>
                {canModify(perms, s) && (
                  <>
                    <button className="grid size-10 place-items-center text-muted" onClick={() => setEditing({ id: s.id, name: s.name, order: s.section_order })} aria-label={`Edita ${s.name}`}>
                      <Pencil className="size-4" />
                    </button>
                    <button className="mr-1 grid size-10 place-items-center text-muted" onClick={() => remove(s)} aria-label={`Esborra ${s.name}`}>
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <button className="btn-secondary w-full" onClick={() => setEditing({ id: null, name: "", order: [] })}>
            <Plus className="size-4" /> Afegeix un supermercat
          </button>
        </div>
      )}
    </Sheet>
  );
}
