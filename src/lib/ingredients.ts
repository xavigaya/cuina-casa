import { guessSection, normalizeText, singularize, type SectionId } from "./sections";
import { normalizeUnit, parseLeadingNumber, type UnitId } from "./units";

export interface ParsedIngredient {
  name: string;
  quantity: number | null;
  unit: UnitId | null;
  section: SectionId;
  optional: boolean;
}

/**
 * Interpreta una línia d'ingredient en text lliure.
 *   "200 g de farina"           → 200 g · farina
 *   "2 cebes"                   → 2 u · cebes
 *   "1 cullerada d'oli d'oliva" → 1 cullerada · oli d'oliva
 *   "sal i pebre (opcional)"    → sense quantitat · sal i pebre · opcional
 */
export function parseIngredientLine(line: string): ParsedIngredient | null {
  let text = line
    .replace(/^[\s\-–•*·]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const optional = /\b(opcional|optional|al gust|al gusto|to taste)\b/i.test(text);
  text = text.replace(/\((opcional|optional)\)/i, "").trim();

  const { value, rest } = parseLeadingNumber(text);
  let quantity = value;
  let remaining = rest;
  let unit: UnitId | null = null;

  // Unitat enganxada o separada: "200g", "200 g", "2 cullerades"
  const unitMatch = remaining.match(/^([a-zA-ZàèéíïòóúüçñÀÈÉÍÏÒÓÚÜÇÑ.]+)\b\.?\s*/);
  if (unitMatch) {
    const candidate = normalizeUnit(unitMatch[1]);
    if (candidate && quantity != null) {
      unit = candidate;
      remaining = remaining.slice(unitMatch[0].length);
    }
  }

  // Treu "de", "d'", "del", "of"
  remaining = remaining.replace(/^(de |d'|d’|del |de la |de les |dels |of )/i, "").trim();

  if (quantity != null && unit == null) unit = "u";

  const name = cleanName(remaining || text);
  if (!name) return null;

  return { name, quantity, unit, section: guessSection(name), optional };
}

function cleanName(name: string): string {
  return name
    .replace(/\s*,\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toLowerCase());
}

/**
 * Clau per comparar ingredients entre receptes, rebost i llista:
 * sense accents, sense plurals simples ni detalls entre parèntesis.
 */
export function ingredientKey(name: string): string {
  const base = normalizeText(name)
    .replace(/\(.*?\)/g, "")
    .replace(/,.*$/, "")
    .replace(/\b(fresc|fresca|frescos|fresques|fresco|picat|picada|ratllat|ratllada|tallat|tallada|a daus|en daus)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return base
    .split(" ")
    .map((w) => singularize(w))
    .join(" ");
}
