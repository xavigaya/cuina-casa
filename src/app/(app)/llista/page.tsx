"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown, PackagePlus, Pencil, Plus, ScanBarcode, Trash2 } from "lucide-react";
import { useHousehold, useLiveTable } from "@/components/household";
import { BarcodeScanner, lookupBarcode, rememberProduct } from "@/components/barcode-scanner";
import { QuantityUnitFields, SectionSelect, parseQty, qtyToString } from "@/components/fields";
import { EmptyState, PageHeader, Sheet, Spinner, toast } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parseIngredientLine } from "@/lib/ingredients";
import { SECTION_ORDER, guessSection, sectionInfo } from "@/lib/sections";
import { formatQuantity, normalizeUnit } from "@/lib/units";
import { NON_FOOD_SECTIONS, addQuantities, defaultLocation, findMergeTarget } from "@/lib/pantry";
import type { PantryItem, ShoppingItem } from "@/lib/types";

export default function ShoppingListPage() {
  const supabase = supabaseBrowser();
  const { household, user } = useHousehold();
  const { rows: items, setRows, loading } = useLiveTable<ShoppingItem>("shopping_items", {
    order: { column: "created_at" },
    offlineKey: "llista",
  });
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showChecked, setShowChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const pending = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  const groups = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>();
    for (const item of pending) {
      const arr = map.get(item.section) ?? [];
      arr.push(item);
      map.set(item.section, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => (SECTION_ORDER[a] ?? 99) - (SECTION_ORDER[b] ?? 99))
      .map(([section, list]) => ({ section: sectionInfo(section), list: list.sort((a, b) => a.name.localeCompare(b.name, "ca")) }));
  }, [pending]);

  async function addItem(input: { name: string; quantity: number | null; unit: string | null; section: string; note?: string | null }) {
    const tempId = `temp-${Date.now()}`;
    const optimistic: ShoppingItem = {
      id: tempId,
      household_id: household.id,
      name: input.name,
      quantity: input.quantity,
      unit: input.unit,
      section: input.section,
      note: input.note ?? null,
      checked: false,
      source: "manual",
      added_by: user.id,
      created_at: new Date().toISOString(),
      checked_at: null,
    };
    setRows((prev) => [...prev, optimistic]);
    const { data, error } = await supabase
      .from("shopping_items")
      .insert({
        household_id: household.id,
        name: input.name,
        quantity: input.quantity,
        unit: input.unit,
        section: input.section,
        note: input.note ?? null,
        added_by: user.id,
      })
      .select()
      .single();
    if (error) {
      setRows((prev) => prev.filter((i) => i.id !== tempId));
      toast("No s'ha pogut afegir");
    } else {
      setRows((prev) => prev.map((i) => (i.id === tempId ? (data as ShoppingItem) : i)));
    }
  }

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseIngredientLine(text);
    if (!parsed) return;
    setText("");
    await addItem({
      name: parsed.name.charAt(0).toUpperCase() + parsed.name.slice(1),
      quantity: parsed.quantity,
      unit: parsed.quantity != null && parsed.unit !== "u" ? parsed.unit : parsed.quantity != null ? "u" : null,
      section: parsed.section,
    });
  }

  async function toggle(item: ShoppingItem) {
    const next = !item.checked;
    setRows((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: next } : i)));
    if (navigator.vibrate) navigator.vibrate(15);
    const { error } = await supabase
      .from("shopping_items")
      .update({ checked: next, checked_at: next ? new Date().toISOString() : null })
      .eq("id", item.id);
    if (error) {
      setRows((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !next } : i)));
      toast("No s'ha pogut desar");
    }
  }

  async function clearChecked() {
    const ids = checked.map((i) => i.id);
    setRows((prev) => prev.filter((i) => !ids.includes(i.id)));
    await supabase.from("shopping_items").delete().in("id", ids);
    toast(`${ids.length} productes esborrats`);
  }

  /** Porta el que s'ha comprat a l'inventari i ho treu de la llista. */
  async function moveCheckedToPantry() {
    setBusy(true);
    const { data: pantryData } = await supabase.from("pantry_items").select("*").eq("household_id", household.id);
    const pantry = (pantryData as PantryItem[]) ?? [];
    let moved = 0;

    for (const item of checked) {
      if (NON_FOOD_SECTIONS.has(item.section)) continue;
      const location = defaultLocation(item.section);
      const target = findMergeTarget(pantry, { name: item.name, unit: item.unit, location });
      if (target) {
        const quantity = addQuantities(target, item);
        await supabase.from("pantry_items").update({ quantity }).eq("id", target.id);
        target.quantity = quantity;
      } else {
        const { data } = await supabase
          .from("pantry_items")
          .insert({
            household_id: household.id,
            name: item.name,
            quantity: item.quantity,
            unit: normalizeUnit(item.unit) ?? item.unit,
            section: item.section,
            location,
          })
          .select()
          .single();
        if (data) pantry.push(data as PantryItem);
      }
      moved++;
    }

    const ids = checked.map((i) => i.id);
    await supabase.from("shopping_items").delete().in("id", ids);
    setRows((prev) => prev.filter((i) => !ids.includes(i.id)));
    setBusy(false);
    toast(moved ? `${moved} productes afegits al rebost` : "Llista netejada");
  }

  const onDetected = useCallback(
    async (barcode: string) => {
      setScanning(false);
      const product = await lookupBarcode(household.id, barcode);
      if (product.known && product.name) {
        await rememberProduct(household.id, product);
        await addItem({ name: product.name, quantity: 1, unit: "u", section: product.section });
        toast(`Afegit: ${product.name}`);
      } else {
        // Producte desconegut: demanem el nom i el recordarem
        setEditing({
          id: `nou:${barcode}`,
          household_id: household.id,
          name: "",
          quantity: 1,
          unit: "u",
          section: "altres",
          note: null,
          checked: false,
          source: "manual",
          added_by: user.id,
          created_at: "",
          checked_at: null,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [household.id],
  );

  return (
    <>
      <PageHeader
        title="Llista de la compra"
        subtitle={pending.length ? `${pending.length} per comprar` : undefined}
      />

      <form onSubmit={quickAdd} className="sticky top-2 z-30 mb-5 flex gap-2">
        <input
          className="input !rounded-full !pl-4 shadow-sm"
          placeholder="Afegeix… (p. ex. 2 l de llet)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="done"
          aria-label="Producte nou"
        />
        <button type="button" className="btn-secondary !px-3" onClick={() => setScanning(true)} aria-label="Escaneja un codi de barres">
          <ScanBarcode className="size-5" />
        </button>
        <button className="btn-primary !px-3" disabled={!text.trim()} aria-label="Afegeix">
          <Plus className="size-5" />
        </button>
      </form>

      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : pending.length === 0 && checked.length === 0 ? (
        <EmptyState emoji="🧺" title="La llista és buida">
          Escriu el que falta a dalt, escaneja un producte o genera la llista des del menú setmanal.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {pending.length === 0 && (
            <div className="card p-5 text-center">
              <p className="font-display text-lg font-semibold">Tot al carro! 🎉</p>
            </div>
          )}

          {groups.map(({ section, list }) => (
            <section key={section.id}>
              <h2 className="mb-2 flex items-center gap-2 font-sans text-xs font-bold uppercase tracking-wider text-muted">
                <span aria-hidden>{section.emoji}</span> {section.label}
              </h2>
              <ul className="card divide-y divide-line overflow-hidden">
                {list.map((item) => (
                  <ItemRow key={item.id} item={item} onToggle={() => toggle(item)} onEdit={() => setEditing(item)} />
                ))}
              </ul>
            </section>
          ))}

          {checked.length > 0 && (
            <section>
              <button
                className="mb-2 flex w-full items-center justify-between text-xs font-bold uppercase tracking-wider text-muted"
                onClick={() => setShowChecked((v) => !v)}
              >
                <span>Al carro ({checked.length})</span>
                <ChevronDown className={`size-4 transition ${showChecked ? "rotate-180" : ""}`} />
              </button>
              {showChecked && (
                <ul className="card mb-3 divide-y divide-line overflow-hidden opacity-70">
                  {checked.map((item) => (
                    <ItemRow key={item.id} item={item} onToggle={() => toggle(item)} onEdit={() => setEditing(item)} />
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button className="btn-primary" onClick={moveCheckedToPantry} disabled={busy}>
                  <PackagePlus className="size-4" /> {busy ? "Desant…" : "Al rebost"}
                </button>
                <button className="btn-secondary" onClick={clearChecked} disabled={busy}>
                  <Trash2 className="size-4" /> Esborra
                </button>
              </div>
              <p className="mt-2 text-center text-xs text-muted">"Al rebost" afegeix el que has comprat a l'inventari de casa.</p>
            </section>
          )}
        </div>
      )}

      <EditItemSheet
        item={editing}
        onClose={() => setEditing(null)}
        onSave={async (values) => {
          const current = editing!;
          setEditing(null);
          if (current.id.startsWith("nou:")) {
            const barcode = current.id.slice(4);
            await rememberProduct(household.id, { barcode, name: values.name, section: values.section });
            await addItem(values);
            return;
          }
          setRows((prev) => prev.map((i) => (i.id === current.id ? { ...i, ...values } : i)));
          await supabase.from("shopping_items").update(values).eq("id", current.id);
        }}
        onDelete={async () => {
          const current = editing!;
          setEditing(null);
          if (current.id.startsWith("nou:")) return;
          setRows((prev) => prev.filter((i) => i.id !== current.id));
          await supabase.from("shopping_items").delete().eq("id", current.id);
          toast(`Esborrat: ${current.name}`, {
            label: "Desfés",
            run: () =>
              addItem({ name: current.name, quantity: current.quantity, unit: current.unit, section: current.section, note: current.note }),
          });
        }}
      />

      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onDetected={onDetected} />
    </>
  );
}

function ItemRow({ item, onToggle, onEdit }: { item: ShoppingItem; onToggle: () => void; onEdit: () => void }) {
  const qty = formatQuantity(item.quantity, item.unit);
  return (
    <li className="flex items-center">
      <button className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left" onClick={onToggle}>
        <span
          className={`grid size-6 shrink-0 place-items-center rounded-full border-2 transition ${
            item.checked ? "border-herb bg-herb text-white" : "border-line"
          }`}
          aria-hidden
        >
          {item.checked && <Check className="size-4" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${item.checked ? "text-muted line-through" : ""}`}>
            {item.name}
            {qty && <span className="ml-2 font-normal text-muted">{qty}</span>}
          </span>
          {item.note && <span className="block truncate text-xs text-muted">{item.note}</span>}
        </span>
        {item.source === "menu" && !item.checked && (
          <span className="shrink-0 rounded-full bg-saffron-soft px-2 py-0.5 text-[10px] font-bold uppercase text-saffron">menú</span>
        )}
      </button>
      <button className="shrink-0 p-3 text-muted" onClick={onEdit} aria-label={`Edita ${item.name}`}>
        <Pencil className="size-4" />
      </button>
    </li>
  );
}

function EditItemSheet({
  item,
  onClose,
  onSave,
  onDelete,
}: {
  item: ShoppingItem | null;
  onClose: () => void;
  onSave: (v: { name: string; quantity: number | null; unit: string | null; section: string; note: string | null }) => void;
  onDelete: () => void;
}) {
  const isNew = item?.id.startsWith("nou:");
  return (
    <Sheet open={!!item} onClose={onClose} title={isNew ? "Producte nou" : "Edita el producte"}>
      {item && <EditItemForm key={item.id} item={item} isNew={!!isNew} onSave={onSave} onDelete={onDelete} />}
    </Sheet>
  );
}

function EditItemForm({
  item,
  isNew,
  onSave,
  onDelete,
}: {
  item: ShoppingItem;
  isNew: boolean;
  onSave: (v: { name: string; quantity: number | null; unit: string | null; section: string; note: string | null }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(qtyToString(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? "");
  const [section, setSection] = useState(item.section);
  const [note, setNote] = useState(item.note ?? "");
  const [sectionTouched, setSectionTouched] = useState(!isNew);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({ name: name.trim(), quantity: parseQty(quantity), unit: unit || null, section, note: note.trim() || null });
      }}
    >
      {isNew && <p className="rounded-xl bg-saffron-soft p-3 text-sm">No coneixem aquest codi. Escriu el nom i el recordarem per a la propera vegada.</p>}
      <div>
        <label className="label" htmlFor="nom">
          Nom
        </label>
        <input
          id="nom"
          className="input"
          value={name}
          autoFocus={isNew}
          onChange={(e) => {
            setName(e.target.value);
            if (!sectionTouched) setSection(guessSection(e.target.value));
          }}
          required
        />
      </div>
      <QuantityUnitFields quantity={quantity} unit={unit} onQuantity={setQuantity} onUnit={setUnit} />
      <SectionSelect
        value={section}
        onChange={(v) => {
          setSection(v);
          setSectionTouched(true);
        }}
      />
      <div>
        <label className="label" htmlFor="nota">
          Nota
        </label>
        <input id="nota" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Marca, mida…" />
      </div>
      <div className="flex gap-2 pt-1">
        {!isNew && (
          <button type="button" className="btn-secondary !text-tomato" onClick={onDelete}>
            <Trash2 className="size-4" /> Esborra
          </button>
        )}
        <button className="btn-primary flex-1">Desa</button>
      </div>
    </form>
  );
}
