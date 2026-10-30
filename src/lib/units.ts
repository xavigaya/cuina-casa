/**
 * Unitats i quantitats: normalització, conversió i format.
 */

export type UnitId =
  | "g" | "kg" | "ml" | "cl" | "dl" | "l"
  | "u" | "cullerada" | "culleradeta" | "pessic" | "gra"
  | "llauna" | "paquet" | "got" | "tassa" | "manat" | "pot" | "llesca";

export const UNIT_OPTIONS: { id: UnitId; label: string }[] = [
  { id: "u", label: "unitats" },
  { id: "g", label: "g" },
  { id: "kg", label: "kg" },
  { id: "ml", label: "ml" },
  { id: "l", label: "l" },
  { id: "cullerada", label: "cullerada" },
  { id: "culleradeta", label: "culleradeta" },
  { id: "pessic", label: "pessic" },
  { id: "gra", label: "gra" },
  { id: "llauna", label: "llauna" },
  { id: "pot", label: "pot" },
  { id: "paquet", label: "paquet" },
  { id: "got", label: "got" },
  { id: "tassa", label: "tassa" },
  { id: "manat", label: "manat" },
  { id: "llesca", label: "llesca" },
];

/** Sinònims (català, castellà, anglès) → unitat canònica. */
const UNIT_ALIASES: Record<string, UnitId> = {
  g: "g", gr: "g", grs: "g", gram: "g", grams: "g", gramo: "g", gramos: "g", gramm: "g",
  kg: "kg", kgs: "kg", quilo: "kg", quilos: "kg", kilo: "kg", kilos: "kg", quilogram: "kg", quilograms: "kg", kilogramo: "kg", kilogramos: "kg",
  ml: "ml", mililitre: "ml", mililitres: "ml", mililitro: "ml", mililitros: "ml",
  cl: "cl", centilitre: "cl", centilitres: "cl",
  dl: "dl", decilitre: "dl", decilitres: "dl",
  l: "l", litre: "l", litres: "l", litro: "l", litros: "l", lt: "l",
  u: "u", ud: "u", uds: "u", unitat: "u", unitats: "u", unidad: "u", unidades: "u", peça: "u", peces: "u", pieza: "u", piezas: "u",
  cullerada: "cullerada", cullerades: "cullerada", cucharada: "cullerada", cucharadas: "cullerada", tbsp: "cullerada", cs: "cullerada",
  culleradeta: "culleradeta", culleradetes: "culleradeta", cucharadita: "culleradeta", cucharaditas: "culleradeta", tsp: "culleradeta", cc: "culleradeta",
  pessic: "pessic", pessics: "pessic", pizca: "pessic", pizcas: "pessic", pinch: "pessic",
  gra: "gra", grans: "gra", diente: "gra", dientes: "gra", clove: "gra", cloves: "gra",
  llauna: "llauna", llaunes: "llauna", lata: "llauna", latas: "llauna", can: "llauna", cans: "llauna",
  pot: "pot", pots: "pot", bote: "pot", botes: "pot", tarro: "pot", tarros: "pot",
  paquet: "paquet", paquets: "paquet", paquete: "paquet", paquetes: "paquet", sobre: "paquet", sobres: "paquet",
  got: "got", gots: "got", vaso: "got", vasos: "got",
  tassa: "tassa", tasses: "tassa", taza: "tassa", tazas: "tassa", cup: "tassa", cups: "tassa",
  manat: "manat", manats: "manat", manojo: "manat", manojos: "manat",
  llesca: "llesca", llesques: "llesca", rebanada: "llesca", rebanadas: "llesca", loncha: "llesca", lonchas: "llesca",
};

export function normalizeUnit(unit: string | null | undefined): UnitId | null {
  if (!unit) return null;
  const key = unit.toLowerCase().replace(/\.$/, "").trim();
  return UNIT_ALIASES[key] ?? null;
}

/** Converteix a una unitat base comparable (g o ml). Les altres es deixen igual. */
export function toBase(quantity: number, unit: UnitId | null): { quantity: number; unit: UnitId | null } {
  switch (unit) {
    case "kg": return { quantity: quantity * 1000, unit: "g" };
    case "l": return { quantity: quantity * 1000, unit: "ml" };
    case "dl": return { quantity: quantity * 100, unit: "ml" };
    case "cl": return { quantity: quantity * 10, unit: "ml" };
    default: return { quantity, unit };
  }
}

/** Torna una quantitat base a una unitat llegible (1500 g → 1,5 kg). */
export function fromBase(quantity: number, unit: UnitId | null): { quantity: number; unit: UnitId | null } {
  if (unit === "g" && quantity >= 1000) return { quantity: quantity / 1000, unit: "kg" };
  if (unit === "ml" && quantity >= 1000) return { quantity: quantity / 1000, unit: "l" };
  return { quantity, unit };
}

/** Arrodoneix de manera raonable per a la cuina. */
export function roundQuantity(q: number, unit: UnitId | null = null): number {
  if (unit === "g" || unit === "ml") {
    if (q >= 100) return Math.ceil(q / 10) * 10;
    return Math.ceil(q);
  }
  if (unit === "u" || unit === "gra" || unit === "llauna" || unit === "paquet" || unit === "pot") {
    return Math.ceil(q - 1e-9);
  }
  return Math.round(q * 100) / 100;
}

export function formatQuantity(quantity: number | null | undefined, unit: string | null | undefined): string {
  if (quantity == null || Number.isNaN(quantity)) return unit ? unitLabel(unit, 1) : "";
  const n = Number(quantity);
  const text = Number.isInteger(n)
    ? String(n)
    : n.toLocaleString("ca-ES", { maximumFractionDigits: 2 });
  if (!unit || unit === "u") return text;
  return `${text} ${unitLabel(unit, n)}`;
}

const PLURALS: Partial<Record<UnitId, string>> = {
  cullerada: "cullerades", culleradeta: "culleradetes", pessic: "pessics", gra: "grans",
  llauna: "llaunes", pot: "pots", paquet: "paquets", got: "gots", tassa: "tasses", manat: "manats", llesca: "llesques",
};

export function unitLabel(unit: string, quantity: number): string {
  const id = unit as UnitId;
  if (quantity !== 1 && PLURALS[id]) return PLURALS[id]!;
  return unit;
}

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅕": 0.2, "⅛": 0.125,
};

/**
 * Llegeix un número al començament d'un text: "2", "0,5", "1/2", "1 1/2", "½", "2-3".
 * Torna el número i la resta del text.
 */
export function parseLeadingNumber(text: string): { value: number | null; rest: string } {
  let s = text.trim();
  for (const [ch, val] of Object.entries(UNICODE_FRACTIONS)) {
    s = s.replace(new RegExp(`(\\d)\\s*${ch}`), (_, d) => `${Number(d) + val}`);
    s = s.replace(ch, String(val));
  }
  const m = s.match(
    /^(\d+(?:[.,]\d+)?)(?:\s+(\d+)\/(\d+))?(?:\/(\d+))?(?:\s*(?:-|–|a)\s*(\d+(?:[.,]\d+)?))?(?=\s|[a-zA-Z]|$)/,
  );
  if (!m) return { value: null, rest: s };
  let value = parseFloat(m[1].replace(",", "."));
  if (m[2] && m[3]) value += Number(m[2]) / Number(m[3]);
  if (m[4]) value = value / Number(m[4]);
  if (m[5]) value = Math.max(value, parseFloat(m[5].replace(",", ".")));
  return { value, rest: s.slice(m[0].length).trim() };
}
