/**
 * Valors nutricionals d'Open Food Facts per als productes escanejats.
 */
import type { HarvardGroup } from "./nutrition";
import { guessSection } from "./sections";

export interface OffNutrition {
  kcal: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
  harvard_group: HarvardGroup;
  pack_g: number | null;
}

/** Grup probable d'un aliment segons el nom (per quan no hi ha més informació). */
export function guessGroupFromName(name: string): HarvardGroup {
  const map: Record<string, HarvardGroup> = {
    fruita: "verdura", carn: "carn_vermella", peix: "peix", lactics: "lactic", xarcuteria: "carn_processada",
    rebost: "cereal_refinat", conserves: "verdura", especies: "condiment", begudes: "beguda", congelats: "verdura", forn: "cereal_refinat",
  };
  return map[guessSection(name)] ?? "condiment";
}

const RULES: [RegExp, HarvardGroup][] = [
  [/fruit-juices|juices|nectars/, "beguda"],
  [/meat-analogues|seitan|tempeh|tofu/, "llegum"],
  [/coconut-milks|coconut-creams/, "greix"],
  [/(whole-?grain|wholemeal|integral).*(pasta|bread|rice|cereal|flour)|(pasta|bread|rice|cereal|flour).*(whole-?grain|wholemeal|integral)/, "cereal_integral"],
  [/hams|sausages|charcuter|prepared-meats|cured-meats|chorizo|salami|bacon|cold-cuts/, "carn_processada"],
  [/poultr|chicken|turkey/, "aviram"],
  [/en:meats|beef|pork|lamb/, "carn_vermella"],
  [/fishes|seafood|tunas|sardines|salmon|anchov|mussels/, "peix"],
  [/en:eggs/, "ou"],
  [/legumes|pulses|chickpeas|lentils|beans|hummus/, "llegum"],
  // Abans que les patates: la categoria general «cereals-and-potatoes» no vol dir patata
  [/pastas|breads|rices|breakfast-cereals|flours|couscous|crackers|toasts|cereal-grains/, "cereal_refinat"],
  [/en:potatoes|potato-chips|french-fries|mashed-potatoes|fried-potatoes/, "patata"],
  [/cheeses|yogurts|milks|dairies|kefir|plant-based-milk/, "lactic"],
  [/nuts|seeds|peanut/, "fruits_secs"],
  [/olive-oils|vegetable-oils|olives/, "oli"],
  [/butters|creams|mayonnaises/, "greix"],
  [/sweets|biscuits|chocolates|confectioner|sugars|desserts|pastries|cakes|jams|honeys|ice-creams/, "sucre"],
  [/vegetables|tomatoes|salads|mushrooms|soups/, "verdura"],
  [/fruits/, "fruita"],
  [/beverages|waters|sodas|wines|beers/, "beguda"],
  [/sauces|condiments|spices|salts|broths|stocks/, "condiment"],
];

export function groupFromCategories(tags: string[] | undefined, name: string): HarvardGroup {
  const joined = (tags ?? []).join(" ").toLowerCase();
  for (const [re, group] of RULES) if (re.test(joined)) return group;
  return guessGroupFromName(name);
}

/** Extreu els valors per 100 g d'un producte d'Open Food Facts (null si no n'hi ha). */
export function parseOffNutrition(product: Record<string, unknown> | null | undefined, name: string): OffNutrition | null {
  const n = product?.nutriments as Record<string, unknown> | undefined;
  if (!n) return null;
  const num = (k: string) => {
    const v = Number(n[k]);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };
  let kcal = num("energy-kcal_100g");
  if (kcal == null) {
    const kj = num("energy-kj_100g") ?? num("energy_100g");
    if (kj != null) kcal = kj / 4.184;
  }
  const carbs = num("carbohydrates_100g");
  const protein = num("proteins_100g");
  const fat = num("fat_100g");
  if (kcal == null || carbs == null || protein == null || fat == null) return null;
  const qty = Number(product?.product_quantity);
  const unit = String(product?.product_quantity_unit ?? "g").toLowerCase();
  return {
    kcal: Math.round(kcal * 10) / 10,
    carbs,
    protein,
    fat,
    fiber: num("fiber_100g") ?? 0,
    harvard_group: groupFromCategories(product?.categories_tags as string[] | undefined, name),
    pack_g: Number.isFinite(qty) && qty > 0 && (unit === "g" || unit === "ml") ? qty : null,
  };
}
