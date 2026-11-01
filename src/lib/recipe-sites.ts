/**
 * Cerca de receptes dins de webs concretes (sense API de pagament).
 *
 * Totes aquestes webs publiquen les receptes en format schema.org/Recipe, que
 * llegeix el nostre importador. Si una web canvia o deixa de respondre, la cerca
 * continua amb les altres. Per afegir-ne o treure'n, edita la llista SITES.
 */
import { normalizeText } from "./sections";
import type { Imbalance } from "./harvard";

export interface RecipeSite {
  id: string;
  name: string;
  lang: "ca" | "es";
  /** Adreça de cerca per a un terme (null si la web no permet buscar aquest terme) */
  searchUrl: (query: string) => string | null;
  /** Extreu les adreces de receptes de la resposta de la cerca */
  extractLinks: (body: string) => string[];
}

const wordpress = (id: string, name: string, origin: string): RecipeSite => ({
  id,
  name,
  lang: "es",
  searchUrl: (q) => `${origin}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&_fields=link&per_page=6`,
  extractLinks: (body) => {
    try {
      const posts = JSON.parse(body) as { link?: string }[];
      return Array.isArray(posts) ? posts.map((p) => p.link).filter((l): l is string => !!l && l.startsWith(origin)) : [];
    } catch {
      return [];
    }
  },
});

const uniq = (xs: string[]) => [...new Set(xs)];

/**
 * Pàgines d'ingredient de Cuines (TV3) que s'han comprovat que existeixen.
 * Cuines no té cercador públic, però sí llistats per ingredient.
 */
export const TV3_INGREDIENTS: Record<string, string[]> = {
  peix: ["peix", "pescado"],
  lluc: ["lluc", "merluza"],
  salmo: ["salmo", "salmon"],
  bacalla: ["bacalla", "bacalao"],
  tonyina: ["tonyina", "atun"],
  marisc: ["marisc", "marisco"],
  musclos: ["musclo", "mejillon"],
  calamar: ["calamar", "calamars", "calamares"],
  sipia: ["sipia", "sepia"],
  pop: ["pop", "pulpo"],
  carbasso: ["carbasso", "calabacin"],
  carbassa: ["carbassa", "calabaza"],
  espinacs: ["espinac", "espinacs", "espinacas"],
  brocoli: ["brocoli", "broquil"],
  porro: ["porro", "puerro"],
  col: ["col", "repollo"],
  coliflor: ["coliflor"],
  bolets: ["bolet", "bolets", "setas", "champinon", "xampinyo"],
  tomaquets: ["tomaquet", "tomaquets", "tomate"],
  ceba: ["ceba", "cebolla"],
  cigro: ["cigro", "cigrons", "garbanzo", "garbanzos"],
  mongetes: ["mongeta", "mongetes", "alubia", "alubias", "judias"],
  llentia: ["llentia", "llenties", "lenteja", "lentejas"],
  pollastre: ["pollastre", "pollo"],
  "gall-dindi": ["gall dindi", "pavo"],
  conill: ["conill", "conejo"],
  ous: ["ou", "ous", "huevo", "huevos", "truita", "tortilla"],
  carn: ["carn", "carne"],
  porc: ["porc", "cerdo"],
  vedella: ["vedella", "ternera"],
  xai: ["xai", "cordero"],
  pasta: ["pasta"],
  cuscus: ["cuscus"],
  quinoa: ["quinoa"],
  fruita: ["fruita", "fruta"],
};

export function tv3Slug(query: string): string | null {
  const words = normalizeText(query);
  for (const [slug, terms] of Object.entries(TV3_INGREDIENTS)) {
    if (terms.some((t) => ` ${words} `.includes(` ${t} `))) return slug;
  }
  return null;
}

export const SITES: RecipeSite[] = [
  {
    id: "tv3",
    name: "Cuines (TV3)",
    lang: "ca",
    searchUrl: (q) => {
      const slug = tv3Slug(q);
      return slug ? `https://www.3cat.cat/tv3/cuines/${slug}/receptes/` : null;
    },
    extractLinks: (body) =>
      uniq((body.match(/\/tv3\/cuines\/recepta\/[a-z0-9-]+\/\d+\//g) ?? []).map((p) => `https://www.3cat.cat${p}`)),
  },
  {
    id: "cookpad",
    name: "Cookpad",
    lang: "es",
    searchUrl: (q) => `https://cookpad.com/es/buscar/${encodeURIComponent(q)}`,
    extractLinks: (body) => uniq((body.match(/\/es\/recetas\/\d+/g) ?? []).map((p) => `https://cookpad.com${p}`)),
  },
  {
    id: "rechupete",
    name: "Recetas de Rechupete",
    lang: "es",
    searchUrl: (q) => `https://www.abc.es/recetasderechupete/?s=${encodeURIComponent(q)}`,
    extractLinks: (body) =>
      uniq(body.match(/https:\/\/www\.abc\.es\/recetasderechupete\/[a-z0-9-]+\/\d+\//g) ?? []).filter(
        (l) => !/\/(menu|menus|que-|como-|por-que|beneficios|propiedades|consejos|trucos)[a-z0-9-]*\//.test(l),
      ),
  },
  wordpress("pequerecetas", "PequeRecetas", "https://www.pequerecetas.com"),
  wordpress("javirecetas", "Javirecetas", "https://www.javirecetas.com"),
];

/**
 * Termes de cerca que compensen un desequilibri. Es donen en castellà (la majoria
 * de webs) i inclouen un ingredient que també té pàgina a Cuines (TV3).
 */
export function queriesForImbalance(imb: Imbalance): string[] {
  const q: string[] = [];
  const missing = imb.missingProteins;
  if (imb.needVeg && (imb.needProtein || missing.length)) {
    if (missing.includes("peix")) q.push("merluza con verduras");
    else if (missing.includes("llegum")) q.push("garbanzos con espinacas");
    else q.push("pollo con verduras");
  }
  if (imb.needVeg) q.push("crema de calabacin", "brocoli");
  if (missing.includes("peix")) q.push("salmon al horno", "merluza");
  if (missing.includes("llegum")) q.push("lentejas con verduras", "garbanzos");
  if (imb.needProtein && !missing.length) q.push(imb.tooMuchRedMeat ? "pollo al horno" : "tortilla de verduras");
  if (imb.refined && !imb.needVeg) q.push("quinoa con verduras");
  if (q.length === 0) q.push("verduras al horno");
  return uniq(q).slice(0, 3);
}
