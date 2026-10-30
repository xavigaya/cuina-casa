import { ingredientKey } from "./ingredients";
import type { Location, PantryItem } from "./types";
import { normalizeUnit, toBase } from "./units";

/** On es desa normalment un producte segons la secció del súper. */
export function defaultLocation(section: string): Location {
  if (section === "congelats") return "congelador";
  if (["lactics", "carn", "peix", "xarcuteria"].includes(section)) return "nevera";
  return "rebost";
}

/** Seccions que no són menjar i no cal portar a l'inventari. */
export const NON_FOOD_SECTIONS = new Set(["neteja", "higiene"]);

/**
 * Busca si al rebost ja hi ha el mateix producte amb una unitat compatible,
 * per sumar-hi la quantitat en lloc de crear-ne un de nou.
 */
export function findMergeTarget(
  pantry: PantryItem[],
  item: { name: string; unit: string | null; location: Location },
): PantryItem | null {
  const key = ingredientKey(item.name);
  const unit = toBase(1, normalizeUnit(item.unit)).unit;
  return (
    pantry.find(
      (p) =>
        p.location === item.location &&
        ingredientKey(p.name) === key &&
        toBase(1, normalizeUnit(p.unit)).unit === unit &&
        !p.expires_on, // si té caducitat, millor un lot nou
    ) ?? null
  );
}

/** Suma dues quantitats amb unitats compatibles i torna el resultat en la unitat de la primera. */
export function addQuantities(
  a: { quantity: number | null; unit: string | null },
  b: { quantity: number | null; unit: string | null },
): number | null {
  if (a.quantity == null || b.quantity == null) return a.quantity ?? b.quantity;
  const ua = normalizeUnit(a.unit);
  const baseA = toBase(Number(a.quantity), ua);
  const baseB = toBase(Number(b.quantity), normalizeUnit(b.unit));
  const total = baseA.quantity + baseB.quantity;
  // Torna-ho a la unitat original
  const factor = toBase(1, ua).quantity;
  return Math.round((total / factor) * 1000) / 1000;
}

