import { parseIngredientLine, type ParsedIngredient } from "./ingredients";

export interface ImportedRecipe {
  title: string;
  servings: number | null;
  prepMinutes: number | null;
  imageUrl: string | null;
  instructions: string;
  ingredients: ParsedIngredient[];
  sourceUrl: string;
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
  while ((match = re.exec(html))) {
    try {
      const data = JSON.parse(match[1].trim());
      const found = searchRecipe(data);
      if (found) return found;
    } catch {
      // JSON mal format: el saltem
    }
  }
  return null;
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
  const ingredientLines = toStringArray(r.recipeIngredient ?? r.ingredients);
  return {
    title: decodeEntities(asString(r.name) ?? "Recepta importada").slice(0, 160),
    servings: parseServings(r.recipeYield),
    prepMinutes: parseDuration(asString(r.totalTime)) ?? sumDurations(asString(r.prepTime), asString(r.cookTime)),
    imageUrl: pickImage(r.image),
    instructions: flattenInstructions(r.recipeInstructions).map(decodeEntities).join("\n"),
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
  if (typeof v === "string") return v.split(/\n+/).filter(Boolean);
  if (Array.isArray(v)) return v.map((x) => asString(x) ?? asString((x as Json)?.text) ?? "").filter(Boolean);
  return [];
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
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}
