"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Search, Trash2 } from "lucide-react";
import { useHousehold } from "@/components/household";
import { EmptyState, PageHeader, Sheet, Spinner, toast } from "@/components/ui";
import { parseQty, qtyToString } from "@/components/fields";
import { supabaseBrowser } from "@/lib/supabase/client";
import { savePrice } from "@/lib/prices";
import { undoLatestFor } from "@/lib/proposals";
import { normalizeText } from "@/lib/sections";
import { formatEuros, priceKey, type ProductPrice } from "@/lib/shopping-plus";
import { UNIT_OPTIONS, formatQuantity } from "@/lib/units";

type Draft = { id?: string; name: string; price: string; quantity: string; unit: string };

export default function PricesPage() {
  const supabase = supabaseBrowser();
  const { household } = useHousehold();
  const [prices, setPrices] = useState<ProductPrice[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [unpriced, setUnpriced] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [pr, list] = await Promise.all([
      supabase.from("product_prices").select("*").eq("household_id", household.id).order("name"),
      supabase.from("shopping_items").select("name").eq("household_id", household.id).eq("checked", false),
    ]);
    setMissing(!!pr.error);
    const rows = pr.error ? [] : ((pr.data as ProductPrice[]) ?? []);
    setPrices(rows);
    const keys = new Set(rows.map((p) => p.key));
    setUnpriced([...new Set(((list.data as { name: string }[]) ?? []).map((i) => i.name).filter((n) => !keys.has(priceKey(n))))].slice(0, 12));
  }, [supabase, household.id]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = normalizeText(query);
    return (prices ?? []).filter((p) => !q || normalizeText(p.name).includes(q));
  }, [prices, query]);

  async function save(d: Draft) {
    const price = parseQty(d.price);
    if (!d.name.trim() || price == null) return toast("Cal el nom i el preu");
    const err = await savePrice(household.id, { name: d.name, price, quantity: parseQty(d.quantity) ?? 1, unit: d.unit || null });
    if (err) return toast(err);
    setEditing(null);
    toast("Preu desat");
    load();
  }

  async function remove(p: ProductPrice) {
    const { error } = await supabase.from("product_prices").delete().eq("id", p.id);
    if (error) return toast("No s'ha pogut esborrar");
    setEditing(null);
    toast(`Preu de ${p.name} esborrat`, {
      label: "Desfés",
      run: async () => {
        toast((await undoLatestFor("product_prices", [p.id])) ?? "Recuperat");
        load();
      },
    });
    load();
  }

  return (
    <>
      <Link href="/llista" className="btn-ghost -ml-3 mb-2 !px-3">
        <ArrowLeft className="size-5" /> Llista
      </Link>
      <PageHeader
        title="Preus"
        subtitle="Aproximats, per calcular el cost de la llista i del menú."
        action={
          <button className="btn-primary !px-3" onClick={() => setEditing({ name: "", price: "", quantity: "1", unit: "u" })} aria-label="Afegeix un preu">
            <Plus className="size-5" />
          </button>
        }
      />

      {missing ? (
        <EmptyState emoji="🛠️" title="Falta actualitzar la base de dades">
          Per desar preus cal executar la migració <code>0007_supermercats_i_preus.sql</code> a Supabase.
        </EmptyState>
      ) : !prices ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-5">
          {unpriced.length > 0 && (
            <section className="card p-4">
              <p className="mb-2 text-sm font-semibold">A la llista i sense preu</p>
              <div className="flex flex-wrap gap-2">
                {unpriced.map((n) => (
                  <button key={n} className="chip" onClick={() => setEditing({ name: n, price: "", quantity: "1", unit: "u" })}>
                    <Plus className="size-3.5" /> {n}
                  </button>
                ))}
              </div>
            </section>
          )}

          {prices.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input className="input !rounded-full !pl-10" placeholder="Busca un producte…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}

          {prices.length === 0 ? (
            <EmptyState emoji="🏷️" title="Encara no hi ha preus">
              Posa preus aquí o des de cada producte de la llista (botó del llapis). No cal que siguin exactes.
            </EmptyState>
          ) : (
            <ul className="card divide-y divide-line">
              {visible.map((p) => (
                <li key={p.id}>
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    onClick={() => setEditing({ id: p.id, name: p.name, price: qtyToString(Number(p.price)), quantity: qtyToString(Number(p.quantity)), unit: p.unit ?? "" })}
                  >
                    <span className="flex-1 font-medium first-letter:uppercase">{p.name}</span>
                    <span className="text-sm tabular-nums">
                      <span className="font-semibold">{formatEuros(Number(p.price))}</span>
                      <span className="text-muted"> / {formatQuantity(Number(p.quantity), p.unit) || "unitat"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edita el preu" : "Preu nou"}>
        {editing && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save(editing);
            }}
          >
            <div>
              <label className="label" htmlFor="p-nom">
                Producte
              </label>
              <input id="p-nom" className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} disabled={!!editing.id} required />
            </div>
            <div className="flex items-end gap-2">
              <div className="w-28">
                <label className="label" htmlFor="p-preu">
                  Preu (€)
                </label>
                <input
                  id="p-preu"
                  className="input"
                  inputMode="decimal"
                  value={editing.price}
                  onChange={(e) => setEditing({ ...editing, price: e.target.value.replace(/[^\d.,]/g, "") })}
                  autoFocus
                  required
                />
              </div>
              <span className="pb-3 text-sm text-muted">per</span>
              <input
                className="input !w-20"
                inputMode="decimal"
                value={editing.quantity}
                onChange={(e) => setEditing({ ...editing, quantity: e.target.value.replace(/[^\d.,]/g, "") })}
                aria-label="Quantitat"
              />
              <select className="input !w-auto" value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} aria-label="Unitat">
                <option value="">—</option>
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted">Per exemple: 1,15 € per 1 l de llet, o 2,40 € per 1 kg de pomes. L&apos;app ho converteix a la quantitat de cada recepta.</p>
            <div className="flex gap-2">
              {editing.id && (
                <button type="button" className="btn-secondary !text-tomato" onClick={() => remove(prices!.find((p) => p.id === editing.id)!)} aria-label="Esborra">
                  <Trash2 className="size-4" />
                </button>
              )}
              <button className="btn-primary flex-1">Desa</button>
            </div>
          </form>
        )}
      </Sheet>
    </>
  );
}
