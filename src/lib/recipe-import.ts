import { parseIngredientLine, type ParsedIngredient } from "./ingredients";

export interface ImportedRecipe {
  title: string;
  servings: number | null;
  prepMinutes: number | null;
  imageUrl: string | null;
  instructions: string;
  ingredients: ParsedIngredient[];
  sourceUrl: string;
  /** Categoria de la web (p. ex. «Primer Plat», «Postre»), si n'hi ha */
  category?: string | null;
}

/**
 * Extreu una recepta d'una pàgina web. La majoria de webs de cuina publiquen
 * les receptes amb dades estructurades schema.org/Recipe (JSON-LD).
 * Si no n'hi ha, es prova amb microdades bàsiques.
 */
export function extractRecipeFromHtml(html: string, sourceUrl: string): ImportedRecipe | null {
  const recipe = findJsonLdRecipe(html);
  if (recipe) return fromSchema(recipe, sourceUrl);
  return fromMicrodata(html, sourceUrl);
}

type Json = Record<string, unknown>;

function findJsonLdRecipe(html: string): Json | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  const broken: string[] = [];
  while ((match = re.exec(html))) {
    const data = parseLenientJson(match[1]);
    if (data === undefined) {
      if (/"@type"\s*:\s*\[?\s*"Recipe"/i.test(match[1])) broken.push(match[1]);
      continue;
    }
    const found = searchRecipe(data);
    if (found) return found;
  }
  // Últim recurs: JSON tan mal format que no es pot llegir; n'extraiem els camps principals
  for (const block of broken) {
    const r = scrapeBrokenRecipe(block);
    if (r) return r;
  }
  return null;
}

/**
 * Llegeix JSON tolerant errors habituals de les webs: salts de línia i tabuladors
 * dins dels textos, comes sobrants, comentaris o comes al començament d'un objecte.
 * Torna undefined si no hi ha manera de llegir-lo.
 */
export function parseLenientJson(raw: string): unknown {
  const text = raw.trim().replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
  try {
    return JSON.parse(text);
  } catch {}
  let fixed = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        fixed += ch + (text[i + 1] ?? "");
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      // Caràcters de control dins d'un text: els convertim en espai
      // Salts de línia dins d'un text: es conserven com a \n; la resta de caràcters de control, espai
      fixed += ch === "\n" ? "\\n" : ch < " " ? " " : ch;
      continue;
    }
    if (ch === '"') inString = true;
    // Comentaris fora dels textos (així no es toquen adreces com https://)
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    fixed += ch;
  }
  fixed = fixed
    .replace(/([{[])\s*,/g, "$1") // coma just després d'obrir
    .replace(/,\s*([}\]])/g, "$1"); // coma sobrant abans de tancar
  try {
    return JSON.parse(fixed);
  } catch {
    return undefined;
  }
}

function unescapeJsonString(s: string): string {
  try {
    return JSON.parse(`"${s.replace(/[\u0000-\u001f]/g, " ")}"`);
  } catch {
    return s;
  }
}

/** Extreu nom, imatge, racions, ingredients i passos d'un bloc JSON-LD trencat. */
function scrapeBrokenRecipe(block: string): Json | null {
  const str = '"((?:[^"\\\\]|\\\\.)*)"';
  const field = (name: string) => block.match(new RegExp(`"${name}"\\s*:\\s*${str}`, "i"))?.[1];
  const list = (name: string) => {
    const m = block.match(new RegExp(`"${name}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i"));
    return m ? [...m[1].matchAll(new RegExp(str, "g"))].map((x) => unescapeJsonString(x[1])) : [];
  };
  const afterType = block.slice(Math.max(0, block.search(/"@type"\s*:\s*\[?\s*"Recipe"/i)));
  const name = afterType.match(new RegExp(`"name"\\s*:\\s*${str}`))?.[1];
  const ingredients = list("recipeIngredient");
  if (!name || ingredients.length === 0) return null;
  const image = field("image") ?? afterType.match(new RegExp(`"image"[\\s\\S]{0,200}?"url"\\s*:\\s*${str}`))?.[1];
  const steps = [...afterType.matchAll(new RegExp(`"text"\\s*:\\s*${str}`, "g"))].map((x) => unescapeJsonString(x[1]));
  return {
    "@type": "Recipe",
    name: unescapeJsonString(name),
    image: image ? unescapeJsonString(image) : undefined,
    recipeYield: field("recipeYield"),
    totalTime: field("totalTime"),
    recipeCategory: field("recipeCategory"),
    recipeIngredient: ingredients,
    recipeInstructions: steps.length ? steps : field("recipeInstructions"),
  };
}

/** Llegeix una clau sense distingir majúscules (algunes webs escriuen «cooktime»). */
function getKey(obj: Json, name: string): unknown {
  if (name in obj) return obj[name];
  const lower = name.toLowerCase();
  const k = Object.keys(obj).find((x) => x.toLowerCase() === lower);
  return k ? obj[k] : undefined;
}

function searchRecipe(node: unknown, depth = 0): Json | null {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = searchRecipe(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === "object") {
    const obj = node as Json;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => typeof t === "string" && t.toLowerCase() === "recipe")) return obj;
    for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
      const r = searchRecipe(obj[key], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function fromSchema(r: Json, sourceUrl: string): ImportedRecipe {
  const ingredientLines = toStringArray(getKey(r, "recipeIngredient") ?? getKey(r, "ingredients"));
  const category = getKey(r, "recipeCategory");
  return {
    title: decodeEntities(asString(r.name) ?? "Recepta importada").slice(0, 160),
    servings: parseServings(getKey(r, "recipeYield")),
    prepMinutes:
      parseDuration(asString(getKey(r, "totalTime"))) ??
      sumDurations(asString(getKey(r, "prepTime")), asString(getKey(r, "cookTime"))),
    imageUrl: pickImage(r.image),
    category: decodeEntities((Array.isArray(category) ? asString(category[0]) : asString(category)) ?? "") || null,
    instructions: flattenInstructions(getKey(r, "recipeInstructions")).map(decodeEntities).join("\n"),
    ingredients: ingredientLines
      .map((l) => parseIngredientLine(decodeEntities(stripTags(l))))
      .filter((x): x is ParsedIngredient => x !== null),
    sourceUrl,
  };
}

function fromMicrodata(html: string, sourceUrl: string): ImportedRecipe | null {
  const ingredients = [...html.matchAll(/itemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\//gi)]
    .map((m) => decodeEntities(stripTags(m[1])))
    .map(parseIngredientLine)
    .filter((x): x is ParsedIngredient => x !== null);
  if (ingredients.length === 0) return null;
  const title =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ??
    html.match(/<title>([^<]+)<\/title>/i)?.[1] ??
    "Recepta importada";
  const image = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ?? null;
  return {
    title: decodeEntities(title).trim().slice(0, 160),
    servings: null,
    prepMinutes: null,
    imageUrl: image,
    instructions: "",
    ingredients,
    sourceUrl,
  };
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

function toStringArray(v: unknown): string[] {
  if (!v) return [];
  const items = typeof v === "string" ? [v] : Array.isArray(v) ? v.map((x) => asString(x) ?? asString((x as Json)?.text) ?? "") : [];
  // Algunes webs (p. ex. TV3) posen tots els ingredients en un sol text, línia per línia
  return items
    .flatMap((x) => x.split(/\r?\n+/))
    .map((x) => x.trim())
    .filter((x) => x && !isIngredientHeader(x));
}

/** Capçaleres dins de la llista d'ingredients: «PER A 4 PERSONES:», «Per a la salsa:», «1 RACIÓ»… */
function isIngredientHeader(line: string): boolean {
  const l = decodeEntities(line).trim();
  if (/:\s*$/.test(l)) return true;
  if (/^(ingredients?|ingredientes?)\b/i.test(l)) return true;
  if (/^(per a|para)\s+\d+\s*(persones?|personas?|racions?|raciones?|comensals?)/i.test(l)) return true;
  if (/^\d+\s*(raci[oó]n?s?|racions|persones?|personas?|comensals?)$/i.test(l)) return true;
  return false;
}

function flattenInstructions(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return stripTags(v).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.flatMap(flattenInstructions);
  if (typeof v === "object") {
    const o = v as Json;
    if (o.itemListElement) return flattenInstructions(o.itemListElement);
    const text = asString(o.text) ?? asString(o.name);
    return text ? [stripTags(text).trim()] : [];
  }
  return [];
}

function pickImage(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return pickImage(v[0]);
  if (typeof v === "object") return asString((v as Json).url);
  return null;
}

export function parseServings(v: unknown): number | null {
  const s = Array.isArray(v) ? asString(v[0]) : asString(v);
  if (!s) return null;
  const n = s.match(/\d+/);
  if (!n) return null;
  const value = Number(n[0]);
  return value > 0 && value <= 50 ? value : null;
}

/** "PT1H30M" → 90 */
export function parseDuration(iso: string | null): number | null {
  if (!iso) return null;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const total = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return total > 0 ? total : null;
}

function sumDurations(a: string | null, b: string | null): number | null {
  const x = parseDuration(a);
  const y = parseDuration(b);
  if (x == null && y == null) return null;
  return (x ?? 0) + (y ?? 0);
}

function stripTags(s: string): string {
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}
