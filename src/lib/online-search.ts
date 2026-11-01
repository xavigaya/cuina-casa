import type { SupabaseClient } from "@supabase/supabase-js";
import { extractRecipeFromHtml } from "./recipe-import";
import type { OnlineRecipe } from "./online-recipes";
import { SITES, matchesKeywords, queriesForImbalance, queryKeywords, relevantFirst } from "./recipe-sites";
import { PROTEIN_KINDS, compensationScore, evaluatePlate, plateShares, proteinKinds, type Imbalance } from "./harvard";
import type { PlateGrams } from "./nutrition";
import { buildFoodIndex, createNutritionCalculator, roundNutrients, type Food } from "./nutrition";
import { courseFromCategory } from "./courses";

const UA = "Mozilla/5.0 (compatible; CuinaCasa/1.0; +https://github.com/xavigaya/cuina-casa)";
const LINKS_PER_SITE = 3;
const MAX_PAGES = 12;

async function fetchText(url: string, timeout = 8000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/json", "Accept-Language": "ca,es;q=0.9" },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 3_000_000 ? null : text;
  } catch {
    return null;
  }
}

/**
 * Busca receptes a les webs de SITES, les llegeix (schema.org/Recipe) i les valora
 * segons el Plat de Harvard. S'executa al servidor.
 */
export async function searchOnlineRecipes(
  supabase: SupabaseClient,
  body: { query?: string; imbalance?: Imbalance | null; exclude?: string[] },
): Promise<{ results: OnlineRecipe[]; queries: string[] }> {
  const query = body.query?.trim().slice(0, 80);
  const imbalance = body.imbalance ?? null;
  const queries = query ? [query] : imbalance ? queriesForImbalance(imbalance) : [];
  if (!queries.length) return { results: [], queries };
  const exclude = new Set(body.exclude ?? []);

  // 1. Cerques a cada web (en paral·lel); cada web aporta poques adreces per tenir varietat
  const searches = queries.flatMap((q) =>
    SITES.map(async (site) => {
      const url = site.searchUrl(q);
      if (!url) return { site, keywords: [] as string[], links: [] as string[] };
      const text = await fetchText(url, 7000);
      const kws = queryKeywords(q);
      return { site, keywords: kws, links: text ? relevantFirst(site.extractLinks(text), kws).slice(0, LINKS_PER_SITE) : [] };
    }),
  );
  const found = await Promise.all(searches);
  const candidates: { url: string; site: string; keywords: string[] }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < LINKS_PER_SITE; i++) {
    for (const f of found) {
      const link = f.links[i];
      if (link && !seen.has(link) && !exclude.has(link)) {
        seen.add(link);
        candidates.push({ url: link, site: f.site.name, keywords: f.keywords });
      }
    }
  }

  // 2. Llegim les receptes (format schema.org/Recipe)
  const pages = await Promise.all(
    candidates.slice(0, MAX_PAGES).map(async (c) => {
      const html = await fetchText(c.url);
      const recipe = html ? extractRecipeFromHtml(html, c.url) : null;
      if (!recipe || recipe.ingredients.length < 3) return null;
      // Ha de tenir relació amb el que s'ha buscat (algunes webs barregen enllaços destacats)
      const text = `${recipe.title} ${recipe.ingredients.map((i) => i.name).join(" ")}`;
      return matchesKeywords(text, c.keywords) ? { ...c, recipe } : null;
    }),
  );
  const recipes = pages.filter((p): p is NonNullable<typeof p> => p !== null);

  // 3. Valor nutricional i Plat de Harvard (si la taula d'aliments existeix)
  let calculator: ReturnType<typeof createNutritionCalculator> | null = null;
  const { data: foods } = await supabase.from("foods").select("*").limit(5000);
  if (foods?.length) {
    const typed = (foods as Food[]).map((f) => ({
      ...f,
      kcal: Number(f.kcal), carbs: Number(f.carbs), protein: Number(f.protein), fat: Number(f.fat), fiber: Number(f.fiber),
      unit_g: f.unit_g == null ? null : Number(f.unit_g), pack_g: f.pack_g == null ? null : Number(f.pack_g),
      density: Number(f.density) || 1, plate_factor: Number(f.plate_factor) || 1,
    }));
    calculator = createNutritionCalculator(new Map(), buildFoodIndex(typed));
  }

  const scored = recipes.map((p, i) => {
    const r = p.recipe;
    const course = courseFromCategory(r.category);
    const nutri = calculator?.compute({
      id: p.url,
      title: r.title,
      servings: r.servings ?? 4,
      ingredients: r.ingredients.map((x) => ({ name: x.name, quantity: x.quantity, unit: x.unit, optional: x.optional })),
    });
    const evaluation = nutri ? evaluatePlate(nutri.plate) : null;
    const incomplete = !!nutri && nutri.missing.length > r.ingredients.length * 0.3;
    let score = -i / 100; // si no hi ha dades, es respecta l'ordre de la cerca
    if (nutri && evaluation) {
      score = imbalance ? compensationScore({ id: p.url, title: r.title, course, plate: nutri.plate }, imbalance) : evaluation.score / 100;
      if (!Number.isFinite(score)) score = -1;
      if (incomplete) score -= 0.3;
      if (course === "postres") score -= 2;
    }
    const item: OnlineRecipe = {
      url: p.url,
      site: p.site,
      title: r.title,
      image: r.imageUrl,
      servings: r.servings,
      prepMinutes: r.prepMinutes,
      course,
      perServing: nutri ? roundNutrients(nutri.perServing) : null,
      plate: nutri?.plate ?? null,
      evaluation: evaluation
        ? { score: evaluation.score, status: evaluation.status, advice: evaluation.advice.map((a) => a.text) }
        : null,
      incomplete,
      compensates: nutri && imbalance ? compensationTags(nutri.plate, imbalance) : [],
      recipe: r,
    };
    return { item, score };
  });

  // 4. Les millors 4, com a molt 2 de la mateixa web. Si falta alguna proteïna
  //    a la setmana (p. ex. peix), s'hi inclou primer la millor recepta que en porti.
  scored.sort((a, b) => b.score - a.score);
  const results: OnlineRecipe[] = [];
  const perSite = new Map<string, number>();
  if (imbalance?.missingProteins.length) {
    const withProtein = scored.find(({ item }) => item.plate && proteinKinds(item.plate).some((k) => imbalance.missingProteins.includes(k)));
    if (withProtein) {
      results.push(withProtein.item);
      perSite.set(withProtein.item.site, 1);
    }
  }
  for (const { item } of scored) {
    if (results.includes(item)) continue;
    if (results.length >= 4) break;
    const n = perSite.get(item.site) ?? 0;
    if (n >= 2) continue;
    perSite.set(item.site, n + 1);
    results.push(item);
  }
  return { results, queries };
}

/** Què aporta una recepta per compensar el desequilibri («Aporta verdura», «Aporta peix»…). */
export function compensationTags(plate: PlateGrams, imb: Imbalance): string[] {
  const s = plateShares(plate);
  const tags: string[] = [];
  if (imb.needVeg && s.vegFruit >= 0.5) tags.push("Aporta verdura");
  for (const k of proteinKinds(plate)) {
    if (imb.missingProteins.includes(k)) tags.push(`Aporta ${PROTEIN_KINDS.find((p) => p.id === k)!.label.toLowerCase()}`);
  }
  if (imb.needProtein && s.protein >= 0.25 && !tags.some((t) => t.startsWith("Aporta ") && t !== "Aporta verdura")) tags.push("Aporta proteïna");
  if (imb.tooMuchGrain && s.total > 0 && s.grains <= 0.2) tags.push("Poc cereal");
  if (imb.refined && s.grains >= 0.1 && s.refinedOfGrains < 0.4) tags.push("Cereal integral");
  return tags;
}
