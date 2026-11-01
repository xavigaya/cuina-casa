/**
 * Traducció automàtica castellà → català amb Apertium (servei públic i gratuït,
 * molt bo entre llengües properes). S'executa al servidor.
 */
import type { ImportedRecipe } from "./recipe-import";
import { guessSection } from "./sections";
import { looksSpanish } from "./translate";

const APERTIUM = "https://apertium.org/apy/translate";
const UA = "Mozilla/5.0 (compatible; CuinaCasa/1.0; +https://github.com/xavigaya/cuina-casa)";
const MAX_CHARS = 3500;

async function apertium(text: string): Promise<string | null> {
  try {
    const res = await fetch(APERTIUM, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": UA },
      body: new URLSearchParams({ langpair: "spa|cat", q: text, markUnknown: "no" }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { responseStatus?: number; responseData?: { translatedText?: string } };
    return json.responseStatus === 200 && typeof json.responseData?.translatedText === "string" ? json.responseData.translatedText : null;
  } catch {
    return null;
  }
}

/**
 * Tradueix una llista de textos d'una línia. S'envien junts (una línia per text)
 * en blocs de mida limitada; si en algun bloc no quadra el nombre de línies,
 * es tradueixen d'un en un. Torna null si el servei no respon.
 */
export async function translateLines(lines: string[]): Promise<string[] | null> {
  const out: string[] = new Array(lines.length);
  const chunks: number[][] = [];
  let current: number[] = [];
  let size = 0;
  lines.forEach((l, i) => {
    if (current.length && size + l.length + 1 > MAX_CHARS) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(i);
    size += l.length + 1;
  });
  if (current.length) chunks.push(current);

  const results = await Promise.all(
    chunks.map(async (idx) => {
      const text = idx.map((i) => lines[i].replace(/\s*\n\s*/g, " ")).join("\n");
      const translated = await apertium(text);
      if (translated == null) return false;
      const parts = translated.split("\n");
      if (parts.length === idx.length) {
        idx.forEach((i, k) => (out[i] = parts[k].trim()));
        return true;
      }
      // No quadra: d'un en un
      const singles = await Promise.all(idx.map((i) => apertium(lines[i])));
      if (singles.some((s) => s == null)) return false;
      idx.forEach((i, k) => (out[i] = singles[k]!.trim()));
      return true;
    }),
  );
  return results.every(Boolean) ? out : null;
}

/** Si la recepta és en castellà, la tradueix al català (títol, ingredients i passos). */
export async function translateRecipeToCatalan(
  r: ImportedRecipe,
): Promise<{ recipe: ImportedRecipe; translated: boolean }> {
  const sample = [r.title, ...r.ingredients.map((i) => i.name), r.instructions].join("\n");
  if (!looksSpanish(sample)) return { recipe: r, translated: false };

  const steps = r.instructions ? r.instructions.split("\n").filter((s) => s.trim()) : [];
  const lines = [r.title, ...r.ingredients.map((i) => i.name), ...steps];
  const t = await translateLines(lines);
  if (!t) return { recipe: r, translated: false };

  const title = t[0];
  const names = t.slice(1, 1 + r.ingredients.length);
  const translatedSteps = t.slice(1 + r.ingredients.length);
  return {
    translated: true,
    recipe: {
      ...r,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      ingredients: r.ingredients.map((ing, i) => {
        const name = names[i] || ing.name;
        return { ...ing, name, section: ing.section !== "altres" ? ing.section : guessSection(name) };
      }),
      instructions: translatedSteps.join("\n"),
    },
  };
}
