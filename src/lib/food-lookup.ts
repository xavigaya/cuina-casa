/**
 * Proposta de valors nutricionals per a un ingredient desconegut, a partir dels
 * productes d'Open Food Facts (mitjana robusta de diversos productes semblants).
 */
import type { HarvardGroup } from "./nutrition";
import { groupFromCategories, guessGroupFromName } from "./off";
import { normalizeText } from "./sections";

export interface FoodProposal {
  name: string;
  kcal: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  harvard_group: HarvardGroup;
  /** Nombre de productes que s'han fet servir per a la mitjana */
  samples: number;
  examples: string[];
}

interface OffProduct {
  product_name?: string;
  product_name_es?: string;
  product_name_ca?: string;
  nutriments?: Record<string, unknown>;
  categories_tags?: string[];
}

const STOP = new Set(["de", "del", "la", "el", "les", "els", "amb", "con", "i", "y", "per", "para", "a", "al", "en"]);

export function significantWords(name: string): string[] {
  return normalizeText(name)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Calcula la proposta a partir dels productes trobats: només els que tenen el nom
 * relacionat amb la cerca i els quatre valors bàsics; mitjana (mediana) de cada valor.
 */
export function proposalFromProducts(name: string, queries: string[], products: OffProduct[]): FoodProposal | null {
  const wordSets = queries.map(significantWords).filter((w) => w.length);
  const usable = products
    .map((p) => {
      const pname = p.product_name_ca || p.product_name_es || p.product_name || "";
      const n = p.nutriments ?? {};
      const num = (k: string) => {
        const v = Number(n[k]);
        return Number.isFinite(v) && v >= 0 ? v : null;
      };
      let kcal = num("energy-kcal_100g");
      if (kcal == null && num("energy-kj_100g") != null) kcal = num("energy-kj_100g")! / 4.184;
      const carbs = num("carbohydrates_100g");
      const protein = num("proteins_100g");
      const fat = num("fat_100g");
      if (!pname || kcal == null || carbs == null || protein == null || fat == null || kcal > 900) return null;
      // El nom del producte ha de contenir totes les paraules d'alguna de les cerques
      const hay = ` ${normalizeText(pname).replace(/[^a-z0-9 ]/g, " ")} `;
      if (!wordSets.some((ws) => ws.every((w) => hay.includes(w)))) return null;
      return { pname, kcal, carbs, protein, fat, fiber: num("fiber_100g"), tags: p.categories_tags };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 12);
  if (!usable.length) return null;

  const groups = new Map<HarvardGroup, number>();
  for (const u of usable) {
    const g = groupFromCategories(u.tags, u.pname);
    groups.set(g, (groups.get(g) ?? 0) + 1);
  }
  const bestGroup = [...groups.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? guessGroupFromName(name);
  const fibers = usable.map((u) => u.fiber).filter((f): f is number => f != null);
  return {
    name,
    kcal: Math.round(median(usable.map((u) => u.kcal))),
    carbs: round1(median(usable.map((u) => u.carbs))),
    protein: round1(median(usable.map((u) => u.protein))),
    fat: round1(median(usable.map((u) => u.fat))),
    fiber: fibers.length ? round1(median(fibers)) : 0,
    harvard_group: bestGroup,
    samples: usable.length,
    examples: [...new Set(usable.map((u) => u.pname))].slice(0, 3),
  };
}

const UA = "CuinaCasa/1.0 (https://github.com/xavigaya/cuina-casa)";
const FIELDS = "product_name,product_name_es,product_name_ca,nutriments,categories_tags";

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Busca productes a Open Food Facts (cercador nou i, si no respon, l'antic). */
export async function searchOffProducts(query: string): Promise<OffProduct[]> {
  const q = encodeURIComponent(query);
  const modern = (await getJson(`https://search.openfoodfacts.org/search?q=${q}&page_size=24&langs=es,ca&fields=${FIELDS}`)) as { hits?: OffProduct[] } | null;
  if (modern?.hits?.length) return modern.hits;
  const legacy = (await getJson(
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=24&fields=${FIELDS}`,
  )) as { products?: OffProduct[] } | null;
  return legacy?.products ?? [];
}
