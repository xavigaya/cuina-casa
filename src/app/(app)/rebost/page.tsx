"use client";

import { useCallback, useMemo, useState } from "react";
import { Minus, Plus, ScanBarcode, Search, ShoppingCart, Trash2 } from "lucide-react";
import { useHousehold, useLiveTable } from "@/components/household";
import { BarcodeScanner, lookupBarcode, rememberProduct } from "@/components/barcode-scanner";
import { QuantityUnitFields, SectionSelect, parseQty, qtyToString } from "@/components/fields";
import { EmptyState, PageHeader, Sheet, Spinner, toast } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { expiryLabel, expiryStatus, type ExpiryStatus } from "@/lib/dates";
import { guessSection, normalizeText, sectionInfo } from "@/lib/sections";
import { formatQuantity } from "@/lib/units";
import { defaultLocation } from "@/lib/pantry";
import { LOCATIONS, type Location, type PantryItem } from "@/lib/types";

type Filter = "tot" | Location | "caduca";

const STATUS_STYLE: Record<ExpiryStatus, string> = {
  caducat: "bg-tomato text-white",
  avui: "bg-tomato-soft text-tomato",
  aviat: "bg-saffron-soft text-saffron",
  ok: "text-muted",
  sense: "",
};

export default function PantryPage() {
  const supabase = supabaseBrowser();
  const { household, user } = useHousehold();
  const { rows: items, setRows, loading } = useLiveTable<PantryItem>("pantry_items", { order: { column: "name" }, offlineKey: "rebost" });
  const [filter, setFilter] = useState<Filter>("tot");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Partial<PantryItem> | null>(null);
  const [scanning, setScanning] = useState(false);

  const warn = household.expiry_warning_days;

  const visible = useMemo(() => {
    const q = normalizeText(query);
    return items
      .filter((i) => {
        if (q && !normalizeText(i.name).includes(q)) return false;
        if (filter === "caduca") return ["caducat", "avui", "aviat"].includes(expiryStatus(i.expires_on, warn));
        if (filter !== "tot") return i.location === filter;
        return true;
      })
      .sort((a, b) => {
        // Primer el que caduca abans; després per nom
        if (a.expires_on && b.expires_on) return a.expires_on.localeCompare(b.expires_on);
        if (a.expires_on) return -1;
        if (b.expires_on) return 1;
        return a.name.localeCompare(b.name, "ca");
      });
  }, [items, filter, query, warn]);

  const expiringCount = items.filter((i) => ["caducat", "avui", "aviat"].includes(expiryStatus(i.expires_on, warn))).length;

  async function addToShoppingList(item: Pick<PantryItem, "name" | "section">) {
    await supabase.from("shopping_items").insert({
      household_id: household.id,
      name: item.name,
      section: item.section,
      source: "rebost",
      added_by: user.id,
    });
    toast(`${item.name} afegit a la llista`);
  }

  async function changeQuantity(item: PantryItem, delta: number) {
    const current = Number(item.quantity ?? 0);
    const step = item.unit === "g" || item.unit === "ml" ? delta * 100 : delta;
    const next = Math.max(0, Math.round((current + step) * 100) / 100);
    if (next === 0) {
      setRows((prev) => prev.filter((i) => i.id !== item.id));
      await supabase.from("pantry_items").delete().eq("id", item.id);
      toast(`S'ha acabat: ${item.name}`, { label: "A la llista", run: () => addToShoppingList(item) });
      return;
    }
    setRows((prev) => prev.map((i) => (i.id === item.id ? { ...i, quantity: next } : i)));
    await supabase.from("pantry_items").update({ quantity: next }).eq("id", item.id);
    if (item.min_quantity != null && next < item.min_quantity && current >= item.min_quantity) {
      toast(`Queda poc ${item.name}`, { label: "A la llista", run: () => addToShoppingList(item) });
    }
  }

  async function save(values: Partial<PantryItem>) {
    const id = editing?.id;
    const barcode = editing?.barcode;
    setEditing(null);
    if (barcode && values.name) await rememberProduct(household.id, { barcode, name: values.name, section: values.section ?? "altres" });
    if (id) {
      setRows((prev) => prev.map((i) => (i.id === id ? { ...i, ...values } : i)));
      const { error } = await supabase.from("pantry_items").update(values).eq("id", id);
      if (error) toast("No s'ha pogut desar");
    } else {
      const { data, error } = await supabase
        .from("pantry_items")
        .insert({ ...values, barcode: barcode ?? null, household_id: household.id })
        .select()
        .single();
      if (error) toast("No s'ha pogut afegir");
      else setRows((prev) => [...prev, data as PantryItem]);
    }
  }

  async function remove() {
    const item = editing as PantryItem;
    setEditing(null);
    setRows((prev) => prev.filter((i) => i.id !== item.id));
    await supabase.from("pantry_items").delete().eq("id", item.id);
    toast(`Esborrat: ${item.name}`);
  }

  const onDetected = useCallback(
    async (barcode: string) => {
      setScanning(false);
      const existing = items.find((i) => i.barcode === barcode);
      const product = await lookupBarcode(household.id, barcode);
      setEditing({
        name: product.name,
        section: product.section,
        quantity: 1,
        unit: "u",
        location: existing?.location ?? defaultLocation(product.section),
        barcode,
      });
    },
    [household.id, items],
  );

  return (
    <>
      <PageHeader
        title="Rebost"
        subtitle={`${items.length} productes a casa`}
        action={
          <div className="flex gap-2">
            <button className="btn-secondary !px-3" onClick={() => setScanning(true)} aria-label="Escaneja">
              <ScanBarcode className="size-5" />
            </button>
            <button className="btn-primary !px-3" onClick={() => setEditing({ location: filter !== "tot" && filter !== "caduca" ? filter : "rebost" })} aria-label="Afegeix">
              <Plus className="size-5" />
            </button>
          </div>
        }
      />

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input className="input !rounded-full !pl-10" placeholder="Busca a casa…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
        <button className="chip" data-active={filter === "tot"} onClick={() => setFilter("tot")}>
          Tot
        </button>
        {LOCATIONS.map((l) => (
          <button key={l.id} className="chip" data-active={filter === l.id} onClick={() => setFilter(l.id)}>
            {l.emoji} {l.label}
          </button>
        ))}
        {expiringCount > 0 && (
          <button className="chip !border-saffron" data-active={filter === "caduca"} onClick={() => setFilter("caduca")}>
            ⏰ Caduca aviat ({expiringCount})
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState emoji="🗄️" title="Encara no hi ha res">
          Afegeix el que tens a casa o, quan tornis del súper, prem "Al rebost" a la llista de la compra.
        </EmptyState>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-muted">No hi ha cap producte amb aquest filtre.</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {visible.map((item) => {
            const status = expiryStatus(item.expires_on, warn);
            const low = item.min_quantity != null && Number(item.quantity ?? 0) < item.min_quantity;
            const loc = LOCATIONS.find((l) => l.id === item.location);
            return (
              <li key={item.id} className="flex items-center gap-2 py-2.5 pl-4 pr-2">
                <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(item)}>
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{item.name}</span>
                    {low && <span className="shrink-0 rounded-full bg-saffron-soft px-2 py-0.5 text-[10px] font-bold uppercase text-saffron">queda poc</span>}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    {filter === "tot" || filter === "caduca" ? <span>{loc?.emoji} {loc?.label}</span> : <span>{sectionInfo(item.section).label}</span>}
                    {item.expires_on && (
                      <span className={`rounded-full px-1.5 py-px font-semibold ${STATUS_STYLE[status]}`}>{expiryLabel(item.expires_on)}</span>
                    )}
                  </span>
                </button>
                {item.quantity != null ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button className="grid size-9 place-items-center rounded-full text-muted active:bg-line" onClick={() => changeQuantity(item, -1)} aria-label={`Treu ${item.name}`}>
                      <Minus className="size-4" />
                    </button>
                    <span className="min-w-12 text-center text-sm font-semibold tabular-nums">{formatQuantity(item.quantity, item.unit)}</span>
                    <button className="grid size-9 place-items-center rounded-full text-muted active:bg-line" onClick={() => changeQuantity(item, 1)} aria-label={`Afegeix ${item.name}`}>
                      <Plus className="size-4" />
                    </button>
                  </div>
                ) : (
                  <button className="grid size-9 place-items-center rounded-full text-muted" onClick={() => addToShoppingList(item)} aria-label={`Afegeix ${item.name} a la llista`}>
                    <ShoppingCart className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edita el producte" : "Afegeix a casa"}>
        {editing && (
          <PantryForm
            key={editing.id ?? editing.barcode ?? "nou"}
            item={editing}
            onSave={save}
            onDelete={editing.id ? remove : undefined}
            onToList={editing.id ? () => addToShoppingList(editing as PantryItem) : undefined}
          />
        )}
      </Sheet>

      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onDetected={onDetected} />
    </>
  );
}

function PantryForm({
  item,
  onSave,
  onDelete,
  onToList,
}: {
  item: Partial<PantryItem>;
  onSave: (v: Partial<PantryItem>) => void;
  onDelete?: () => void;
  onToList?: () => void;
}) {
  const [name, setName] = useState(item.name ?? "");
  const [quantity, setQuantity] = useState(qtyToString(item.quantity));
  const [unit, setUnit] = useState(item.unit ?? "u");
  const [location, setLocation] = useState<Location>(item.location ?? "rebost");
  const [section, setSection] = useState(item.section ?? "altres");
  const [expires, setExpires] = useState(item.expires_on ?? "");
  const [min, setMin] = useState(qtyToString(item.min_quantity));
  const [sectionTouched, setSectionTouched] = useState(!!item.id || !!item.section);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({
          name: name.trim(),
          quantity: parseQty(quantity),
          unit: unit || null,
          location,
          section,
          expires_on: expires || null,
          min_quantity: parseQty(min),
        });
      }}
    >
      {item.barcode && !item.name && (
        <p className="rounded-xl bg-saffron-soft p-3 text-sm">No coneixem aquest codi. Escriu el nom i el recordarem.</p>
      )}
      <div>
        <label className="label" htmlFor="p-nom">
          Nom
        </label>
        <input
          id="p-nom"
          className="input"
          value={name}
          required
          autoFocus={!item.id}
          onChange={(e) => {
            setName(e.target.value);
            if (!sectionTouched) {
              const s = guessSection(e.target.value);
              setSection(s);
              setLocation(defaultLocation(s));
            }
          }}
        />
      </div>
      <QuantityUnitFields quantity={quantity} unit={unit} onQuantity={setQuantity} onUnit={setUnit} />
      <div>
        <span className="label">On és?</span>
        <div className="grid grid-cols-3 gap-2">
          {LOCATIONS.map((l) => (
            <button
              type="button"
              key={l.id}
              className="chip justify-center !py-2.5"
              data-active={location === l.id}
              onClick={() => {
                setLocation(l.id);
                setSectionTouched(true);
              }}
            >
              {l.emoji} {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="p-cad">
            Caduca el
          </label>
          <input id="p-cad" type="date" className="input" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="p-min">
            Avisa'm si en queden menys de
          </label>
          <input id="p-min" className="input" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="—" />
        </div>
      </div>
      <SectionSelect
        id="p-sec"
        value={section}
        onChange={(v) => {
          setSection(v);
          setSectionTouched(true);
        }}
      />
      <div className="flex flex-wrap gap-2 pt-1">
        {onDelete && (
          <button type="button" className="btn-secondary !text-tomato" onClick={onDelete}>
            <Trash2 className="size-4" />
          </button>
        )}
        {onToList && (
          <button type="button" className="btn-secondary" onClick={onToList}>
            <ShoppingCart className="size-4" /> A la llista
          </button>
        )}
        <button className="btn-primary flex-1">Desa</button>
      </div>
    </form>
  );
}
