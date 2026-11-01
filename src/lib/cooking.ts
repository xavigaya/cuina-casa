/**
 * Cuinar: què es gasta del rebost en fer una recepta, temporitzadors dels
 * passos, receptes per aprofitar el que caduca i plantilles de menú.
 */
import { ingredientKey } from "./ingredients";
import { matchFood, toGrams, type FoodIndex } from "./nutrition";
import { formatQuantity, normalizeUnit, roundQuantity, toBase, type UnitId } from "./units";
import type { RecipeNode } from "./shopping";
import type { Location, Meal } from "./types";

// ---------------------------------------------------------------------------
// Descomptar del rebost
// ---------------------------------------------------------------------------

export interface StockRow {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  location: Location;
  expires_on: string | null;
  min_quantity: number | null;
}

/** Un ingredient que es gasta (ja escalat a les racions i amb els preelaborats desplegats) */
export interface Use {
  name: string;
  /** noms alternatius per trobar-lo al rebost (el títol del preelaborat) */
  keys: string[];
  quantity: number | null;
  unit: string | null;
  recipe: string;
}

export interface Deduction {
  item: StockRow;
  /** el que en queda, en la unitat del rebost (null = no se sap quant en tenim) */
  after: number | null;
  /** text del que es gasta: «200 g», «2 u»… */
  used: string;
  /** ingredients de la recepta que hi corresponen */
  ingredients: string[];
  /** s'ha pogut calcular amb seguretat (si no, es proposa però desmarcat) */
  sure: boolean;
}

export interface CookPlan {
  deductions: Deduction[];
  /** ingredients que no s'han trobat al rebost */
  notAtHome: string[];
  /** ingredients sense quantitat («sal», «oli al gust»): no es descompten */
  vague: string[];
}

const MAX_DEPTH = 4;

/**
 * Llista el que es gasta en cuinar una recepta per a unes racions. Si un
 * preelaborat (sofregit, brou…) és al rebost, es gasta d'allà; si no, es
 * despleguen els seus ingredients, com quan es fa la llista de la compra.
 */
export function expandUses(
  recipeId: string,
  servings: number,
  recipes: Map<string, RecipeNode>,
  stock: Pick<StockRow, "name" | "quantity">[],
  defaultServings: number,
): Use[] {
  const uses: Use[] = [];
  const stockKeys = new Set(stock.filter((s) => s.quantity == null || Number(s.quantity) > 0).map((s) => ingredientKey(s.name)));

  const walk = (recipe: RecipeNode, portions: number, depth: number, seen: Set<string>) => {
    const recipeServings = recipe.servings > 0 ? recipe.servings : defaultServings;
    const factor = portions / recipeServings;
    for (const ing of recipe.ingredients) {
      if (ing.optional || !ing.name.trim()) continue;
      const qty = ing.quantity != null ? Number(ing.quantity) * factor : null;
      const sub = ing.sub_recipe_id ? recipes.get(ing.sub_recipe_id) : undefined;
      const keys = [ingredientKey(ing.name), ...(sub ? [ingredientKey(sub.title)] : [])];
      if (!sub || seen.has(sub.id) || depth >= MAX_DEPTH || keys.some((k) => stockKeys.has(k))) {
        uses.push({ name: ing.name.trim(), keys, quantity: qty, unit: ing.unit, recipe: recipe.title });
        continue;
      }
      // Cal fer el preelaborat: quantes racions?
      let subPortions = portions;
      if (qty != null && sub.yield_quantity) {
        const need = toBase(qty, normalizeUnit(ing.unit));
        const yieldBase = toBase(Number(sub.yield_quantity), normalizeUnit(sub.yield_unit));
        if ((need.unit ?? "u") === (yieldBase.unit ?? "u") && yieldBase.quantity > 0) {
          subPortions = (need.quantity / yieldBase.quantity) * (sub.servings > 0 ? sub.servings : defaultServings);
        }
      }
      walk(sub, subPortions, depth + 1, new Set([...seen, sub.id]));
    }
  };

  const recipe = recipes.get(recipeId);
  if (recipe) walk(recipe, servings, 0, new Set([recipe.id]));
  return uses;
}

/**
 * Converteix una quantitat a la unitat d'un producte del rebost.
 * Primer amb unitats directament comparables (g/kg, ml/l…) i, si no, passant
 * per grams amb el pes de l'aliment (1 ceba ≈ 150 g).
 */
export function convertQuantity(
  quantity: number,
  from: string | null,
  to: string | null,
  food: Parameters<typeof toGrams>[2],
): number | null {
  const uf = normalizeUnit(from) ?? (from ? null : "u");
  const ut = normalizeUnit(to) ?? (to ? null : "u");
  const a = toBase(quantity, uf);
  const unitFactor = toBase(1, ut);
  if ((a.unit ?? "u") === (unitFactor.unit ?? "u")) return a.quantity / unitFactor.quantity;
  const grams = toGrams(quantity, uf, food).grams;
  const perUnit = toGrams(1, ut, food).grams;
  if (grams == null || perUnit == null || perUnit <= 0) return null;
  return grams / perUnit;
}

/**
 * Proposa com queda el rebost després de cuinar. Es gasten primer els lots
 * que caduquen abans. Mai no toca res: només calcula.
 */
export function planCooking(uses: Use[], stock: StockRow[], foods: FoodIndex | null): CookPlan {
  const remaining = new Map(stock.map((s) => [s.id, s.quantity == null ? null : Number(s.quantity)]));
  const touched = new Map<string, { used: Map<string, number>; ingredients: Set<string>; sure: boolean }>();
  const notAtHome: string[] = [];
  const vague: string[] = [];

  const byKey = new Map<string, StockRow[]>();
  for (const s of stock) {
    const k = ingredientKey(s.name);
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => (a.expires_on ?? "9999").localeCompare(b.expires_on ?? "9999"));
  }

  for (const use of uses) {
    const candidates = [...new Set(use.keys)].flatMap((k) => byKey.get(k) ?? []);
    if (!candidates.length) {
      notAtHome.push(use.name);
      continue;
    }
    if (use.quantity == null) {
      vague.push(use.name);
      continue;
    }
    const food = foods ? matchFood(foods, use.name) : null;
    let left = use.quantity; // en la unitat de la recepta
    for (const item of candidates) {
      if (left <= 1e-9) break;
      const have = remaining.get(item.id);
      const t = touched.get(item.id) ?? { used: new Map(), ingredients: new Set<string>(), sure: true };
      t.ingredients.add(use.name);
      if (have == null) {
        // En tenim però no sabem quant: es proposa (desmarcat) per si s'ha acabat
        t.sure = false;
        touched.set(item.id, t);
        left = 0;
        break;
      }
      if (have <= 0) continue;
      const needInItemUnit = convertQuantity(left, use.unit, item.unit, food);
      if (needInItemUnit == null) {
        t.sure = false;
        touched.set(item.id, t);
        left = 0;
        break;
      }
      const take = Math.min(have, needInItemUnit);
      remaining.set(item.id, have - take);
      const unitKey = use.unit ?? "";
      t.used.set(unitKey, (t.used.get(unitKey) ?? 0) + (take / needInItemUnit) * left);
      left -= (take / needInItemUnit) * left;
      touched.set(item.id, t);
    }
  }

  const deductions: Deduction[] = [];
  for (const item of stock) {
    const t = touched.get(item.id);
    if (!t) continue;
    const after = remaining.get(item.id) ?? null;
    const unit = normalizeUnit(item.unit);
    deductions.push({
      item,
      after: after == null ? null : Math.max(0, roundQuantity(after, unit === "u" ? null : unit)),
      used: [...t.used].map(([u, q]) => formatQuantity(roundQuantity(q, normalizeUnit(u)), u || null)).filter(Boolean).join(" + "),
      ingredients: [...t.ingredients],
      sure: t.sure && after != null,
    });
  }
  return { deductions, notAtHome: [...new Set(notAtHome)], vague: [...new Set(vague)] };
}

// ---------------------------------------------------------------------------
// Temporitzadors: durades escrites als passos
// ---------------------------------------------------------------------------

export interface StepDuration {
  seconds: number;
  label: string;
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, dues: 2, tres: 3, quatre: 4, cuatro: 4, cinc: 5, cinco: 5, sis: 6, seis: 6,
  set: 7, siete: 7, vuit: 8, ocho: 8, nou: 9, nueve: 9, deu: 10, diez: 10, dotze: 12, doce: 12,
  quinze: 15, quince: 15, vint: 20, veinte: 20, "vint-i-cinc": 25, veinticinco: 25, trenta: 30, treinta: 30,
  quaranta: 40, cuarenta: 40, "quaranta-cinc": 45, cincuenta: 50, cinquanta: 50, seixanta: 60, sesenta: 60, noranta: 90, noventa: 90,
};

const NUM = String.raw`(\d+(?:[.,]\d+)?|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|")})`;
const UNIT_H = String.raw`(?:hores|hora|horas|h)`;
const UNIT_M = String.raw`(?:minuts|minut|minutos|minuto|mins|min)`;
const UNIT_S = String.raw`(?:segons|segon|segundos|segundo|seg|s)`;

function num(s: string): number {
  const w = NUMBER_WORDS[s.toLowerCase()];
  return w ?? Number(s.replace(",", "."));
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  if (m && s) return `${m} min ${s} s`;
  if (m) return `${m} min`;
  return `${s} s`;
}

/**
 * Troba les durades d'un pas: «20 minuts», «1 hora i mitja», «mitja hora»,
 * «10-15 min» (es pren la primera, per mirar-s'ho a temps), «30 segundos».
 */
export function parseDurations(text: string): StepDuration[] {
  const found: { at: number; seconds: number; label?: string }[] = [];
  const t = text.toLowerCase();
  const taken: [number, number][] = [];
  const add = (at: number, len: number, seconds: number, label?: string) => {
    if (seconds <= 0 || seconds > 24 * 3600) return;
    if (taken.some(([a, b]) => at < b && at + len > a)) return;
    taken.push([at, at + len]);
    found.push({ at, seconds: Math.round(seconds), label });
  };
  const run = (re: RegExp, fn: (m: RegExpExecArray) => number, label?: (m: RegExpExecArray) => string) => {
    for (const m of t.matchAll(re)) add(m.index!, m[0].length, fn(m as RegExpExecArray), label?.(m as RegExpExecArray));
  };
  const b = String.raw`(?<![\p{L}\d])`;
  const e = String.raw`(?![\p{L}])`;
  // 1 hora i 15 minuts / 1 h 30 min
  run(new RegExp(`${b}${NUM}\\s*${UNIT_H}\\s*(?:i|y|,)?\\s*${NUM}\\s*${UNIT_M}${e}`, "giu"), (m) => num(m[1]) * 3600 + num(m[2]) * 60);
  // 1 hora i mitja / una hora y media / 2 hores i quart
  run(new RegExp(`${b}${NUM}\\s*${UNIT_H}\\s*(?:i|y)\\s*(mitja|media|quart|cuarto)${e}`, "giu"), (m) => num(m[1]) * 3600 + (/^(mitja|media)$/.test(m[2]) ? 1800 : 900));
  run(new RegExp(`${b}(?:mitja|media)\\s*hora${e}`, "giu"), () => 1800);
  run(new RegExp(`${b}tres\\s*quarts\\s*d'?\\s*hora${e}`, "giu"), () => 2700);
  run(new RegExp(`${b}(?:un|1)\\s*quart\\s*d'?\\s*hora${e}`, "giu"), () => 900);
  // 10-15 minuts, 10 a 15 minutos (es pren el primer)
  run(new RegExp(`${b}${NUM}\\s*(?:-|–|a|o|or)\\s*${NUM}\\s*(${UNIT_H}|${UNIT_M}|${UNIT_S})${e}`, "giu"), (m) => num(m[1]) * unitSeconds(m[3]),
    (m) => `${num(m[1])}-${num(m[2])} ${unitSeconds(m[3]) === 3600 ? "h" : unitSeconds(m[3]) === 60 ? "min" : "s"}`,
  );
  run(new RegExp(`${b}${NUM}\\s*(${UNIT_H}|${UNIT_M}|${UNIT_S})${e}`, "giu"), (m) => num(m[1]) * unitSeconds(m[2]));
  return found.sort((a, b2) => a.at - b2.at).map((f) => ({ seconds: f.seconds, label: f.label ?? formatDuration(f.seconds) }));
}

function unitSeconds(unit: string): number {
  if (/^h/.test(unit)) return 3600;
  if (/^m/.test(unit)) return 60;
  return 1;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// ---------------------------------------------------------------------------
// Aprofitar el que caduca
// ---------------------------------------------------------------------------

export interface UseItUpSuggestion {
  id: string;
  title: string;
  image_url: string | null;
  /** productes que caduquen que fa servir */
  uses: string[];
  /** ingredients (no opcionals) que no hi ha a casa */
  missing: number;
}

/** Coincideix un ingredient amb un producte del rebost (mateix nom o mateix aliment de la taula). */
function sameThing(ingredient: string, product: string, foods: FoodIndex | null): boolean {
  const a = ingredientKey(ingredient);
  const p = ingredientKey(product);
  if (!a || !p) return false;
  if (a === p) return true;
  // «espinacs» al rebost i «espinacs baby» a la recepta
  if (p.length >= 4 && a.startsWith(p + " ")) return true;
  if (a.length >= 4 && p.startsWith(a + " ")) return true;
  if (foods) {
    const fa = matchFood(foods, ingredient);
    const fp = matchFood(foods, product);
    if (fa && fp && fa.id === fp.id && fa.harvard_group !== "condiment") return true;
  }
  return false;
}

export function suggestForExpiring(
  expiring: { name: string }[],
  recipes: { id: string; title: string; image_url?: string | null; is_component?: boolean; ingredients: { name: string; optional?: boolean }[] }[],
  pantry: { name: string }[],
  foods: FoodIndex | null,
  limit = 4,
): UseItUpSuggestion[] {
  if (!expiring.length) return [];
  const homeKeys = new Set(pantry.map((p) => ingredientKey(p.name)));
  const out: UseItUpSuggestion[] = [];
  for (const r of recipes) {
    if (r.is_component || !r.ingredients.length) continue;
    const uses = expiring.filter((x) => r.ingredients.some((i) => sameThing(i.name, x.name, foods))).map((x) => x.name);
    if (!uses.length) continue;
    const missing = r.ingredients.filter(
      (i) => !i.optional && !homeKeys.has(ingredientKey(i.name)) && !pantry.some((p) => sameThing(i.name, p.name, foods)),
    ).length;
    out.push({ id: r.id, title: r.title, image_url: r.image_url ?? null, uses: [...new Set(uses)], missing });
  }
  return out.sort((a, b) => b.uses.length - a.uses.length || a.missing - b.missing || a.title.localeCompare(b.title, "ca")).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Plantilles de menú
// ---------------------------------------------------------------------------

export interface TemplateEntry {
  /** 0 = dilluns … 6 = diumenge */
  dow: number;
  meal: Meal;
  recipe_id: string | null;
  /** títol de la recepta en desar-la, per si després s'esborra */
  title: string | null;
  note: string | null;
  servings: number | null;
}

export interface MenuTemplate {
  id: string;
  household_id: string;
  name: string;
  entries: TemplateEntry[];
  created_by: string | null;
  created_at: string;
}

function dayIndex(iso: string, mondayISO: string): number {
  const [y1, m1, d1] = iso.split("-").map(Number);
  const [y2, m2, d2] = mondayISO.split("-").map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/** Converteix els àpats d'una setmana en plantilla (sense les propostes pendents). */
export function weekToTemplate(
  entries: { day: string; meal: Meal; recipe_id: string | null; note: string | null; servings: number | null; status?: string; recipes?: { title: string } | null }[],
  mondayISO: string,
): TemplateEntry[] {
  return entries
    .filter((e) => e.status !== "proposta")
    .map((e) => ({
      dow: dayIndex(e.day, mondayISO),
      meal: e.meal,
      recipe_id: e.recipe_id,
      title: e.recipes?.title ?? null,
      note: e.recipe_id ? null : e.note,
      servings: e.servings,
    }))
    .filter((e) => e.dow >= 0 && e.dow <= 6 && (e.recipe_id || e.note))
    .sort((a, b) => a.dow - b.dow || a.meal.localeCompare(b.meal));
}

/**
 * Files de meal_plan per aplicar una plantilla a la setmana que comença en
 * `mondayISO`. Si una recepta ja no existeix, el plat queda sense recepta amb el seu nom.
 */
export function templateToRows(template: TemplateEntry[], mondayISO: string, householdId: string, existingRecipes: Set<string>) {
  return template.map((e) => {
    const keep = e.recipe_id && existingRecipes.has(e.recipe_id);
    return {
      household_id: householdId,
      day: addDaysISO(mondayISO, e.dow),
      meal: e.meal,
      recipe_id: keep ? e.recipe_id : null,
      note: keep ? null : e.note ?? e.title ?? "Plat",
      servings: e.servings,
    };
  });
}

export type { UnitId };
