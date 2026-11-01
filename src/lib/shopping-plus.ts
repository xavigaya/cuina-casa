/**
 * La compra: ordre de seccions per supermercat, preus aproximats, productes
 * habituals i cua de canvis per quan no hi ha cobertura.
 */
import { convertQuantity, expandUses } from "./cooking";
import { ingredientKey } from "./ingredients";
import { matchFood, type FoodIndex } from "./nutrition";
import { SECTIONS, SECTION_ORDER } from "./sections";
import type { ShoppingItem } from "./types";

// ---------------------------------------------------------------------------
// Supermercats
// ---------------------------------------------------------------------------

export interface Store {
  id: string;
  household_id: string;
  name: string;
  section_order: string[];
  created_by: string | null;
}

/** Ordre complet de seccions d'un súper: les que té desades i, al final, les que falten en l'ordre habitual. */
export function fullSectionOrder(order: string[] | null | undefined): string[] {
  const known = SECTIONS.map((s) => s.id as string);
  const mine = (order ?? []).filter((s, i, arr) => known.includes(s) && arr.indexOf(s) === i);
  return [...mine, ...known.filter((s) => !mine.includes(s))];
}

/** Posició de cada secció per ordenar la llista (sense súper, l'ordre per defecte) */
export function sectionRank(order: string[] | null | undefined): Record<string, number> {
  if (!order?.length) return SECTION_ORDER;
  return Object.fromEntries(fullSectionOrder(order).map((s, i) => [s, i]));
}

export function moveSection(order: string[], section: string, delta: -1 | 1): string[] {
  const list = fullSectionOrder(order);
  const i = list.indexOf(section);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

// ---------------------------------------------------------------------------
// Preus
// ---------------------------------------------------------------------------

export interface ProductPrice {
  id: string;
  household_id: string;
  name: string;
  key: string;
  /** euros que costa `quantity` `unit` */
  price: number;
  quantity: number;
  unit: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type PriceIndex = Map<string, ProductPrice>;

export function priceKey(name: string): string {
  return ingredientKey(name);
}

export function buildPriceIndex(prices: ProductPrice[]): PriceIndex {
  return new Map(prices.map((p) => [p.key, p]));
}

/** El preu d'un producte pel nom (també si a la llista diu «llet sencera» i el preu és de «llet») */
export function findPrice(index: PriceIndex, name: string): ProductPrice | null {
  const key = priceKey(name);
  if (!key) return null;
  const exact = index.get(key);
  if (exact) return exact;
  const words = key.split(" ");
  for (let n = words.length - 1; n >= 1; n--) {
    const hit = index.get(words.slice(0, n).join(" "));
    if (hit && hit.key.length >= 3) return hit;
  }
  return null;
}

/**
 * Cost aproximat d'una quantitat d'un producte (null si no té preu o les
 * unitats no es poden comparar). Sense quantitat, compta una unitat del preu
 * (un paquet, un litre…), que és el que es compraria.
 */
export function estimateCost(
  item: { name: string; quantity: number | null; unit: string | null },
  prices: PriceIndex,
  foods: FoodIndex | null,
): number | null {
  const p = findPrice(prices, item.name);
  if (!p) return null;
  const price = Number(p.price);
  const per = Number(p.quantity) || 1;
  if (item.quantity == null) return price;
  const food = foods ? matchFood(foods, item.name) : null;
  const q = convertQuantity(Number(item.quantity), item.unit, p.unit, food);
  if (q == null) return null;
  return (price * q) / per;
}

export interface CostSummary {
  total: number;
  priced: number;
  /** noms dels productes sense preu (o amb unitats que no es poden comparar) */
  missing: string[];
}

export function summarizeCost(items: { name: string; quantity: number | null; unit: string | null }[], prices: PriceIndex, foods: FoodIndex | null): CostSummary {
  let total = 0;
  let priced = 0;
  const missing: string[] = [];
  for (const item of items) {
    const c = estimateCost(item, prices, foods);
    if (c == null) missing.push(item.name);
    else {
      total += c;
      priced++;
    }
  }
  return { total: Math.round(total * 100) / 100, priced, missing: [...new Set(missing)] };
}

export function formatEuros(n: number): string {
  return n.toLocaleString("ca", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Productes habituals
// ---------------------------------------------------------------------------

export interface Purchase {
  name: string;
  at: string; // ISO
}

export interface HabitualSuggestion {
  name: string;
  key: string;
  times: number;
  /** cada quants dies es compra, de mitjana */
  everyDays: number;
  /** dies des de l'última vegada */
  sinceDays: number;
}

const DAY = 86400000;

/**
 * Productes que es compren sovint i que ja toca tornar a comprar: comprats
 * almenys 3 dies diferents, i ha passat (gairebé) el temps habitual des de
 * l'última vegada. Els que ja són a la llista no surten.
 */
export function habitualSuggestions(
  purchases: Purchase[],
  onList: { name: string }[],
  now: Date = new Date(),
  limit = 8,
): HabitualSuggestion[] {
  const listed = new Set(onList.map((i) => ingredientKey(i.name)));
  const byKey = new Map<string, { name: string; lastAt: number; days: Set<number> }>();
  for (const p of purchases) {
    const key = ingredientKey(p.name);
    const t = Date.parse(p.at);
    if (!key || Number.isNaN(t)) continue;
    const day = Math.floor(t / DAY);
    const g = byKey.get(key) ?? { name: p.name, lastAt: 0, days: new Set<number>() };
    g.days.add(day);
    if (t >= g.lastAt) {
      g.lastAt = t;
      g.name = p.name;
    }
    byKey.set(key, g);
  }
  const today = Math.floor(now.getTime() / DAY);
  const out: HabitualSuggestion[] = [];
  for (const [key, g] of byKey) {
    if (listed.has(key) || g.days.size < 3) continue;
    const days = [...g.days].sort((a, b) => a - b);
    const everyDays = (days[days.length - 1] - days[0]) / (days.length - 1);
    const sinceDays = today - days[days.length - 1];
    if (everyDays > 45 || everyDays < 1) continue;
    if (sinceDays < Math.max(1, everyDays * 0.8)) continue;
    if (sinceDays > everyDays * 4 + 14) continue; // fa massa que no es compra: ja no és habitual
    out.push({ name: g.name.charAt(0).toUpperCase() + g.name.slice(1), key, times: days.length, everyDays: Math.round(everyDays * 10) / 10, sinceDays });
  }
  return out.sort((a, b) => b.sinceDays / b.everyDays - a.sinceDays / a.everyDays || b.times - a.times).slice(0, limit);
}

/** Compres a partir del registre: les vegades que algú ha marcat un producte com a comprat */
export function purchasesFromLog(
  entries: { label: string | null; at: string; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null }[],
): Purchase[] {
  return entries
    .filter((e) => e.action === "update" && e.label && e.new_data?.checked === true && e.old_data?.checked !== true)
    .map((e) => ({ name: e.label!, at: e.at }));
}

// ---------------------------------------------------------------------------
// Cua de canvis sense connexió
// ---------------------------------------------------------------------------

export type QueuedOp =
  | { kind: "insert"; tempId: string; row: Omit<ShoppingItem, "id"> }
  | { kind: "update"; id: string; values: Partial<Pick<ShoppingItem, "checked" | "checked_at" | "name" | "quantity" | "unit" | "section" | "note">> };

export function isTempId(id: string): boolean {
  return id.startsWith("pendent-");
}

/** Afegeix un canvi a la cua, ajuntant-lo amb el que ja hi havia per al mateix producte */
export function enqueue(queue: QueuedOp[], op: QueuedOp): QueuedOp[] {
  if (op.kind === "insert") return [...queue, op];
  const next = [...queue];
  const ins = next.findIndex((q) => q.kind === "insert" && q.tempId === op.id);
  if (ins >= 0) {
    const q = next[ins] as Extract<QueuedOp, { kind: "insert" }>;
    next[ins] = { ...q, row: { ...q.row, ...op.values } };
    return next;
  }
  const upd = next.findIndex((q) => q.kind === "update" && q.id === op.id);
  if (upd >= 0) {
    const q = next[upd] as Extract<QueuedOp, { kind: "update" }>;
    next[upd] = { ...q, values: { ...q.values, ...op.values } };
    return next;
  }
  return [...next, op];
}

/** La llista tal com es veurà quan s'enviïn els canvis pendents */
export function applyQueue(items: ShoppingItem[], queue: QueuedOp[]): ShoppingItem[] {
  let out = [...items];
  for (const op of queue) {
    if (op.kind === "insert") {
      if (!out.some((i) => i.id === op.tempId)) out.push({ ...op.row, id: op.tempId });
    } else {
      out = out.map((i) => (i.id === op.id ? { ...i, ...op.values } : i));
    }
  }
  return out;
}

/** Sembla un error de xarxa (i no un error de permisos o de dades)? */
export function isNetworkError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /fetch|network|load failed|connection|timeout/i.test(error.message ?? "") && !error.code;
}

// ---------------------------------------------------------------------------
// Cost del menú
// ---------------------------------------------------------------------------

/**
 * Cost aproximat de cuinar uns àpats (tots els ingredients, amb els
 * preelaborats desplegats), tant si ja hi són a casa com si no.
 */
export function weekCost(
  meals: { recipeId: string; servings: number | null }[],
  recipes: Map<string, import("./shopping").RecipeNode>,
  prices: PriceIndex,
  foods: FoodIndex | null,
  defaultServings: number,
): CostSummary & { portions: number } {
  const uses = meals.flatMap((m) => expandUses(m.recipeId, m.servings ?? defaultServings, recipes, [], defaultServings));
  const summary = summarizeCost(uses, prices, foods);
  const portions = meals.reduce((n, m) => n + (recipes.has(m.recipeId) ? (m.servings ?? defaultServings) : 0), 0);
  return { ...summary, portions };
}
