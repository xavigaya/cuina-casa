"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, CloudOff, PackagePlus, Pencil, Plus, RotateCcw, ScanBarcode, Store as StoreIcon, Trash2, X } from "lucide-react";
import { useHousehold, useLiveTable, usePermissions } from "@/components/household";
import { canDeleteShoppingItem, canEditShoppingItem } from "@/lib/permissions";
import { undoDeletes } from "@/lib/proposals";
import {
  applyQueue,
  buildPriceIndex,
  enqueue,
  estimateCost,
  findPrice,
  formatEuros,
  habitualSuggestions,
  isNetworkError,
  isTempId,
  purchasesFromLog,
  sectionRank,
  summarizeCost,
  type HabitualSuggestion,
  type ProductPrice,
  type QueuedOp,
  type Store,
} from "@/lib/shopping-plus";
import { savePrice } from "@/lib/prices";
import { StoreSheet, useSelectedStore } from "@/components/store-sheet";
import { loadFoods } from "@/lib/use-nutrition";
import { buildFoodIndex, type FoodIndex } from "@/lib/nutrition";
import { BarcodeScanner, lookupBarcode, rememberProduct } from "@/components/barcode-scanner";
import { QuantityUnitFields, SectionSelect, parseQty, qtyToString } from "@/components/fields";
import { EmptyState, PageHeader, Sheet, Spinner, toast } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parseIngredientLine } from "@/lib/ingredients";
import { guessSection, sectionInfo } from "@/lib/sections";
import { UNIT_OPTIONS, formatQuantity, normalizeUnit } from "@/lib/units";
import { NON_FOOD_SECTIONS, addQuantities, defaultLocation, findMergeTarget } from "@/lib/pantry";
import type { PantryItem, ShoppingItem } from "@/lib/types";

export default function ShoppingListPage() {
  const supabase = supabaseBrowser();
  const { household, user } = useHousehold();
  const perms = usePermissions();
  const { rows: items, setRows, loading, reload } = useLiveTable<ShoppingItem>("shopping_items", {
    order: { column: "created_at" },
    offlineKey: "llista",
  });
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showChecked, setShowChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emptyOpen, setEmptyOpen] = useState(false);

  // Canvis fets sense cobertura: es desen al mòbil i s'envien quan torna la connexió
  const queueKey = `cuina-casa:cua-llista:${household.id}`;
  const [queue, setQueueState] = useState<QueuedOp[]>([]);
  const [online, setOnline] = useState(true);
  const queueRef = useRef<QueuedOp[]>([]);
  const flushing = useRef(false);
  const setQueue = useCallback(
    (next: QueuedOp[]) => {
      queueRef.current = next;
      setQueueState(next);
      try {
        if (next.length) localStorage.setItem(queueKey, JSON.stringify(next));
        else localStorage.removeItem(queueKey);
      } catch {}
    },
    [queueKey],
  );

  const flush = useCallback(async () => {
    if (flushing.current || !queueRef.current.length || navigator.onLine === false) return;
    flushing.current = true;
    let sent = 0;
    while (queueRef.current.length) {
      const [op, ...rest] = queueRef.current;
      const { error } =
        op.kind === "insert"
          ? await supabase.from("shopping_items").insert({ ...op.row })
          : await supabase.from("shopping_items").update(op.values).eq("id", op.id);
      if (error && isNetworkError(error)) break; // encara sense connexió: ho tornarem a provar
      if (error) toast(`No s'ha pogut desar un canvi de la llista: ${error.message}`);
      else sent++;
      setQueue(rest);
    }
    flushing.current = false;
    if (sent) {
      toast(sent === 1 ? "S'ha desat el canvi fet sense cobertura" : `S'han desat els ${sent} canvis fets sense cobertura`);
      reload();
    }
  }, [supabase, setQueue, reload]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(queueKey) ?? "[]") as QueuedOp[];
      queueRef.current = saved;
      setQueueState(saved);
    } catch {}
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("focus", flush);
    const t = setTimeout(flush, 500);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener("focus", flush);
    };
  }, [queueKey, flush]);

  // Supermercats, preus i historial de compres (si la migració 0007 no hi és, simplement no surten)
  const [stores, setStores] = useState<Store[]>([]);
  const [storesMissing, setStoresMissing] = useState(false);
  const [storeId, setStoreId] = useSelectedStore(household.id);
  const [storeOpen, setStoreOpen] = useState(false);
  const [prices, setPrices] = useState<ProductPrice[]>([]);
  const [foods, setFoods] = useState<FoodIndex | null>(null);
  const [purchases, setPurchases] = useState<{ name: string; at: string }[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const hiddenKey = `cuina-casa:habituals-amagats:${household.id}:${new Date().toISOString().slice(0, 10)}`;

  const loadExtras = useCallback(async () => {
    const since = new Date(Date.now() - 120 * 86400000).toISOString();
    const [st, pr, log] = await Promise.all([
      supabase.from("stores").select("*").eq("household_id", household.id).order("name"),
      supabase.from("product_prices").select("*").eq("household_id", household.id),
      supabase
        .from("activity_log")
        .select("label, at, action, old_data, new_data")
        .eq("household_id", household.id)
        .eq("table_name", "shopping_items")
        .eq("action", "update")
        .gte("at", since)
        .order("id", { ascending: false })
        .limit(3000),
    ]);
    setStoresMissing(!!st.error);
    if (!st.error) setStores((st.data as Store[]) ?? []);
    if (!pr.error) setPrices((pr.data as ProductPrice[]) ?? []);
    if (!log.error) setPurchases(purchasesFromLog((log.data as Parameters<typeof purchasesFromLog>[0]) ?? []));
  }, [supabase, household.id]);

  useEffect(() => {
    loadExtras();
    loadFoods(household.id)
      .then((f) => setFoods(buildFoodIndex(f)))
      .catch(() => {});
    try {
      setHidden(new Set(JSON.parse(localStorage.getItem(hiddenKey) ?? "[]") as string[]));
    } catch {}
  }, [loadExtras, household.id, hiddenKey]);

  const store = stores.find((x) => x.id === storeId) ?? null;
  const priceIndex = useMemo(() => buildPriceIndex(prices), [prices]);

  const shown = useMemo(() => applyQueue(items, queue), [items, queue]);
  const pending = shown.filter((i) => !i.checked);
  const checked = shown.filter((i) => i.checked);

  const rank = useMemo(() => sectionRank(store?.section_order), [store]);
  const cost = useMemo(() => summarizeCost(pending, priceIndex, foods), [pending, priceIndex, foods]);
  const habituals = useMemo(
    () => habitualSuggestions(purchases, shown).filter((h) => !hidden.has(h.key)).slice(0, 6),
    [purchases, shown, hidden],
  );

  function hideHabitual(h: HabitualSuggestion) {
    const next = new Set(hidden).add(h.key);
    setHidden(next);
    try {
      localStorage.setItem(hiddenKey, JSON.stringify([...next]));
    } catch {}
  }

  const groups = useMemo(() => {
    const map = new Map<string, ShoppingItem[]>();
    for (const item of pending) {
      const arr = map.get(item.section) ?? [];
      arr.push(item);
      map.set(item.section, arr);
    }
    return [...map.entries()]
      .sort(([a], [b]) => (rank[a] ?? 99) - (rank[b] ?? 99))
      .map(([section, list]) => ({ section: sectionInfo(section), list: list.sort((a, b) => a.name.localeCompare(b.name, "ca")) }));
  }, [pending, rank]);

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
    const queueIt = () => {
      const pendingId = `pendent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const { id: _drop, ...row } = optimistic;
      setRows((prev) => prev.filter((i) => i.id !== tempId));
      setQueue(enqueue(queueRef.current, { kind: "insert", tempId: pendingId, row }));
    };
    if (navigator.onLine === false) return queueIt();
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
    if (error && isNetworkError(error)) {
      queueIt();
    } else if (error) {
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
    const values = { checked: next, checked_at: next ? new Date().toISOString() : null };
    if (navigator.vibrate) navigator.vibrate(15);
    if (isTempId(item.id) || navigator.onLine === false || queueRef.current.some((q) => q.kind === "update" && q.id === item.id)) {
      setQueue(enqueue(queueRef.current, { kind: "update", id: item.id, values }));
      return;
    }
    setRows((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: next } : i)));
    const { error } = await supabase.from("shopping_items").update(values).eq("id", item.id);
    if (error && isNetworkError(error)) {
      setRows((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !next } : i)));
      setQueue(enqueue(queueRef.current, { kind: "update", id: item.id, values }));
    } else if (error) {
      setRows((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !next } : i)));
      toast("No s'ha pogut desar");
    }
  }

  /** Esborra productes de la llista i permet desfer-ho durant uns segons. */
  async function removeItems(everything: ShoppingItem[], message: string) {
    // Els que encara no s'han enviat (fets sense cobertura) es treuen de la cua
    const queued = new Set(everything.filter((i) => isTempId(i.id)).map((i) => i.id));
    if (queued.size) setQueue(queueRef.current.filter((q) => !(q.kind === "insert" && queued.has(q.tempId))));
    const all = everything.filter((i) => !queued.has(i.id));
    if (!all.length) {
      if (queued.size) toast(message);
      return;
    }
    if (navigator.onLine === false) {
      toast("Sense connexió no es pot treure res de la llista");
      return;
    }
    // Un col·laborador només treu el que ha afegit ell i el que ja s'ha comprat
    const list = all.filter((i) => canDeleteShoppingItem(perms, i));
    const kept = all.length - list.length;
    if (kept) message += kept === 1 ? " (1 producte d'una altra persona s'hi queda)" : ` (${kept} productes d'altres persones s'hi queden)`;
    if (!list.length) {
      if (kept) toast("Aquests productes els ha afegit una altra persona: no els pots treure");
      return;
    }
    const ids = list.map((i) => i.id);
    setRows((prev) => prev.filter((i) => !ids.includes(i.id)));
    const { error } = await supabase.from("shopping_items").delete().in("id", ids);
    if (error) {
      toast("No s'ha pogut buidar la llista");
      setRows((prev) => [...prev, ...list]);
      return;
    }
    toast(message, {
      label: "Desfés",
      run: async () => {
        // Primer amb el registre (conserva qui ho havia afegit); si no hi és, es tornen a crear
        if (!(await undoDeletes("shopping_items", ids))) {
          reload();
          return;
        }
        const { data } = await supabase
          .from("shopping_items")
          .insert(list.map(({ id: _id, ...rest }) => rest))
          .select();
        if (data) setRows((prev) => [...prev, ...(data as ShoppingItem[])]);
      },
    });
  }

  async function clearChecked() {
    await removeItems(checked, `${checked.length} productes esborrats`);
  }

  async function emptyList(which: "carro" | "tot") {
    setEmptyOpen(false);
    if (which === "carro") await removeItems(checked, checked.length === 1 ? "S'ha buidat el carro (1 producte)" : `S'ha buidat el carro (${checked.length} productes)`);
    else await removeItems(shown, "S'ha buidat la llista de la compra");
  }

  /** Porta el que s'ha comprat a l'inventari i ho treu de la llista. */
  async function moveCheckedToPantry() {
    if (navigator.onLine === false || queueRef.current.length) {
      toast(navigator.onLine === false ? "Cal connexió per passar-ho al rebost" : "Espera que s'enviïn els canvis pendents");
      flush();
      return;
    }
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
        action={
          shown.length > 0 && (
            <button className="btn-secondary !px-3" onClick={() => setEmptyOpen(true)} aria-label="Buida la llista" title="Buida la llista">
              <Trash2 className="size-5" />
            </button>
          )
        }
      />

      {(!online || queue.length > 0) && (
        <div className="mb-3 flex items-center gap-2 rounded-2xl bg-saffron-soft px-3 py-2 text-sm">
          <CloudOff className="size-4 shrink-0 text-saffron" />
          <p className="flex-1">
            {!online ? "Sense connexió. " : ""}
            {queue.length
              ? `${queue.length === 1 ? "1 canvi" : `${queue.length} canvis`} es desaran quan tornis a tenir cobertura.`
              : "Pots afegir i marcar productes: es desaran quan tornis a tenir cobertura."}
          </p>
          {online && queue.length > 0 && (
            <button className="shrink-0 rounded-full p-1.5 text-saffron" onClick={flush} aria-label="Torna-ho a provar ara">
              <RotateCcw className="size-4" />
            </button>
          )}
        </div>
      )}

      <form onSubmit={quickAdd} className="sticky top-2 z-30 mb-3 flex gap-2">
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

      <div className="mb-4 flex items-center justify-between gap-2 text-sm">
        <button className="flex min-w-0 items-center gap-1.5 rounded-full bg-card px-3 py-1.5 font-semibold ring-1 ring-line" onClick={() => setStoreOpen(true)}>
          <StoreIcon className="size-4 shrink-0 text-muted" />
          <span className="truncate">{store ? store.name : "Ordre habitual"}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted" />
        </button>
        {pending.length > 0 && (cost.priced > 0 || prices.length > 0) && (
          <Link href="/preus" className="shrink-0 text-right text-muted" title="Preus aproximats">
            {cost.priced > 0 && <span className="font-semibold text-ink">≈ {formatEuros(cost.total)}</span>}
            {cost.missing.length > 0 && <span className="block text-xs">{cost.missing.length} sense preu</span>}
          </Link>
        )}
      </div>

      {habituals.length > 0 && (
        <div className="mb-5">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">Sols comprar</p>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {habituals.map((h) => (
              <span key={h.key} className="flex shrink-0 items-center rounded-full bg-card ring-1 ring-line">
                <button
                  className="flex items-center gap-1 py-1.5 pl-3 pr-1 text-sm font-medium"
                  onClick={() => addItem({ name: h.name, quantity: null, unit: null, section: guessSection(h.name) })}
                  title={`Es compra cada ${Math.round(h.everyDays)} dies; l'última vegada fa ${h.sinceDays}`}
                >
                  <Plus className="size-3.5 text-herb" /> {h.name}
                </button>
                <button className="py-1.5 pl-1 pr-2.5 text-muted" onClick={() => hideHabitual(h)} aria-label={`Amaga ${h.name} per avui`}>
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

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
                  <ItemRow key={item.id} item={item} cost={item.checked ? null : estimateCost(item, priceIndex, foods)} onToggle={() => toggle(item)} onEdit={!isTempId(item.id) && canEditShoppingItem(perms, item) ? () => setEditing(item) : undefined} />
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
                    <ItemRow key={item.id} item={item} cost={item.checked ? null : estimateCost(item, priceIndex, foods)} onToggle={() => toggle(item)} onEdit={!isTempId(item.id) && canEditShoppingItem(perms, item) ? () => setEditing(item) : undefined} />
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
        price={editing ? findPrice(priceIndex, editing.name) : null}
        onSave={async (values, price) => {
          const current = editing!;
          setEditing(null);
          if (price) {
            const err = await savePrice(household.id, { name: values.name, ...price });
            if (err) toast(err);
            else loadExtras();
          }
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
            run: async () => {
              if (!(await undoDeletes("shopping_items", [current.id]))) return reload();
              addItem({ name: current.name, quantity: current.quantity, unit: current.unit, section: current.section, note: current.note });
            },
          });
        }}
      />

      <Sheet open={emptyOpen} onClose={() => setEmptyOpen(false)} title="Buidar la llista">
        <div className="space-y-2">
          {checked.length > 0 && (
            <button className="btn-secondary w-full !justify-start !py-3 text-left" onClick={() => emptyList("carro")}>
              <Check className="size-5 shrink-0 text-herb" />
              <span>
                <span className="block font-semibold">Buida només el carro</span>
                <span className="block text-xs font-normal text-muted">
                  Esborra {checked.length === 1 ? "el producte marcat" : `els ${checked.length} productes marcats`} i deixa la resta
                </span>
              </span>
            </button>
          )}
          <button className="btn-secondary w-full !justify-start !py-3 text-left !text-tomato" onClick={() => emptyList("tot")}>
            <Trash2 className="size-5 shrink-0" />
            <span>
              <span className="block font-semibold">Buida tota la llista</span>
              <span className="block text-xs font-normal text-muted">
                Esborra {items.length === 1 ? "l'únic producte" : `els ${items.length} productes`}, comprats o no
              </span>
            </span>
          </button>
          {checked.length > 0 && (
            <p className="pt-1 text-xs text-muted">
              Si ja has tornat del súper, fes servir millor «Al rebost»: afegeix el que has comprat a l'inventari i ho treu de la llista.
            </p>
          )}
          <p className="text-xs text-muted">Després tindràs uns segons per desfer-ho.</p>
        </div>
      </Sheet>

      <StoreSheet
        open={storeOpen}
        onClose={() => setStoreOpen(false)}
        stores={stores}
        selected={store?.id ?? null}
        onSelect={setStoreId}
        onChanged={loadExtras}
        missing={storesMissing}
      />

      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onDetected={onDetected} />
    </>
  );
}

function ItemRow({ item, cost, onToggle, onEdit }: { item: ShoppingItem; cost?: number | null; onToggle: () => void; onEdit?: () => void }) {
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
        {isTempId(item.id) && <CloudOff className="size-3.5 shrink-0 text-saffron" aria-label="Pendent d'enviar" />}
        {cost != null && <span className="shrink-0 text-xs tabular-nums text-muted">{formatEuros(cost)}</span>}
        {item.source === "menu" && !item.checked && (
          <span className="shrink-0 rounded-full bg-saffron-soft px-2 py-0.5 text-[10px] font-bold uppercase text-saffron">menú</span>
        )}
      </button>
      {onEdit ? (
        <button className="shrink-0 p-3 text-muted" onClick={onEdit} aria-label={`Edita ${item.name}`}>
          <Pencil className="size-4" />
        </button>
      ) : (
        <span className="w-10 shrink-0" aria-hidden />
      )}
    </li>
  );
}

type PriceInput = { price: number; quantity: number; unit: string | null };

function EditItemSheet({
  item,
  onClose,
  onSave,
  onDelete,
  price,
}: {
  item: ShoppingItem | null;
  onClose: () => void;
  onSave: (v: { name: string; quantity: number | null; unit: string | null; section: string; note: string | null }, price?: PriceInput) => void;
  onDelete: () => void;
  price: ProductPrice | null;
}) {
  const isNew = item?.id.startsWith("nou:");
  return (
    <Sheet open={!!item} onClose={onClose} title={isNew ? "Producte nou" : "Edita el producte"}>
      {item && <EditItemForm key={item.id} item={item} isNew={!!isNew} onSave={onSave} onDelete={onDelete} price={price} />}
    </Sheet>
  );
}

function EditItemForm({
  item,
  isNew,
  onSave,
  onDelete,
  price,
}: {
  item: ShoppingItem;
  isNew: boolean;
  onSave: (v: { name: string; quantity: number | null; unit: string | null; section: string; note: string | null }, price?: PriceInput) => void;
  onDelete: () => void;
  price: ProductPrice | null;
}) {
  const [priceText, setPriceText] = useState(price ? qtyToString(Number(price.price)) : "");
  const [perQty, setPerQty] = useState(qtyToString(price ? Number(price.quantity) : (item.quantity ?? 1)));
  const [perUnit, setPerUnit] = useState(price ? (price.unit ?? "") : (item.unit ?? "u"));
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
        const p = parseQty(priceText);
        const changed =
          p != null && (!price || p !== Number(price.price) || (parseQty(perQty) ?? 1) !== Number(price.quantity) || (perUnit || null) !== price.unit);
        onSave(
          { name: name.trim(), quantity: parseQty(quantity), unit: unit || null, section, note: note.trim() || null },
          changed ? { price: p!, quantity: parseQty(perQty) ?? 1, unit: perUnit || null } : undefined,
        );
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
      <fieldset>
        <legend className="label">Preu aproximat (opcional)</legend>
        <div className="flex items-center gap-2">
          <input
            className="input !w-24"
            inputMode="decimal"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0,00"
            aria-label="Preu en euros"
          />
          <span className="text-sm text-muted">€ per</span>
          <input
            className="input !w-16"
            inputMode="decimal"
            value={perQty}
            onChange={(e) => setPerQty(e.target.value.replace(/[^\d.,]/g, ""))}
            aria-label="Quantitat a què correspon el preu"
          />
          <select className="input !w-auto" value={perUnit} onChange={(e) => setPerUnit(e.target.value)} aria-label="Unitat del preu">
            <option value="">—</option>
            {UNIT_OPTIONS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1 text-xs text-muted">Es farà servir per calcular el cost de la llista i del menú. Tota la família el veu.</p>
      </fieldset>
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
