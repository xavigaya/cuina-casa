/**
 * Preferències de menjar de la família: al·lèrgies (els 14 al·lèrgens de
 * declaració obligatòria a la UE, o ingredients concrets) i el que algú no
 * menja. Serveix per avisar a les receptes i al menú; és orientatiu, no
 * substitueix llegir les etiquetes.
 */
import { ingredientKey } from "./ingredients";
import { normalizeText } from "./sections";

export interface Allergen {
  id: string;
  label: string;
  emoji: string;
  /** paraules (sense accents) que delaten l'al·lergen en el nom d'un ingredient */
  words: string[];
  /** si el nom porta alguna d'aquestes, no compta (p. ex. «llet de coco») */
  except?: string[];
}

export const ALLERGENS: Allergen[] = [
  {
    id: "gluten",
    label: "Gluten",
    emoji: "🌾",
    words: ["farina", "harina", "blat", "trigo", "ordi", "cebada", "segol", "centeno", "civada", "avena", "espelta", "kamut", "seitan", "pa", "pan", "pasta", "macarro", "espagueti", "espaguetis", "fideu", "fideus", "fideo", "tallarina", "lasanya", "canelo", "canelons", "cuscus", "bulgur", "galeta", "galleta", "brioix", "croissant", "pa ratllat", "pan rallado", "cervesa", "cerveza", "massa de pizza", "pasta brisa", "pasta de full", "hojaldre", "beixamel", "bechamel", "sémola", "semola", "magdalena", "bescuit", "bizcocho", "torrada", "crackers"],
    except: ["blat de moro", "maiz", "sense gluten", "sin gluten", "farina d'arros", "harina de arroz", "farina de garbanzo", "farina de cigro", "fajol", "trigo sarraceno"],
  },
  { id: "crustacis", label: "Crustacis", emoji: "🦐", words: ["gamba", "gambes", "llagosti", "langostino", "escamarla", "cigala", "cranc", "cangrejo", "llamanta", "bogavante", "llagosta", "langosta", "galera", "necora", "carabiner", "carabinero", "krill", "surimi", "pals de cranc"] },
  { id: "ous", label: "Ous", emoji: "🥚", words: ["ou", "ous", "huevo", "huevos", "rovell", "yema", "clara d'ou", "clara de huevo", "maionesa", "mayonesa", "allioli amb ou", "merenga", "merengue"] },
  { id: "peix", label: "Peix", emoji: "🐟", words: ["peix", "pescado", "salmo", "salmon", "tonyina", "atun", "bacalla", "bacalao", "lluc", "merluza", "anxova", "anxoves", "anchoa", "seito", "boqueron", "sardina", "rap", "rape", "llobarro", "lubina", "orada", "dorada", "lluç", "gall de sant pere", "emperador", "peix espasa", "verat", "caballa", "truita de riu", "brou de peix", "fumet", "salsa de peix", "lenguado", "llenguado", "sorell", "jurel"] },
  { id: "cacauets", label: "Cacauets", emoji: "🥜", words: ["cacauet", "cacauets", "cacahuete", "cacahuetes", "mani", "crema de cacauet", "mantega de cacauet"] },
  { id: "soja", label: "Soja", emoji: "🫘", words: ["soja", "soia", "tofu", "tempeh", "edamame", "salsa de soja", "miso", "tamari"] },
  {
    id: "llet",
    label: "Llet i làctics",
    emoji: "🥛",
    words: ["llet", "leche", "formatge", "queso", "nata", "crema de llet", "mantega", "mantequilla", "iogurt", "yogur", "mato", "requeso", "mascarpone", "mozzarella", "parmesa", "parmesano", "ricotta", "beixamel", "bechamel", "quark", "kefir", "brie", "cheddar", "emmental", "gruyere", "llet condensada", "ghee", "lactosa"],
    except: ["llet de coco", "leche de coco", "llet d'ametlla", "leche de almendra", "llet de soja", "leche de soja", "llet de civada", "leche de avena", "mantega de cacauet", "crema de cacauet", "sense lactosa", "sin lactosa", "llet sense lactosa"],
  },
  { id: "fruits_secs", label: "Fruits secs de closca", emoji: "🌰", words: ["ametlla", "ametlles", "almendra", "almendras", "avellana", "avellanes", "nou", "nous", "nuez", "nueces", "anacard", "anacards", "anacardo", "festuc", "festucs", "pistacho", "macadamia", "pecana", "nou pecana", "nou del brasil", "pinyo", "pinyons", "pinon", "pinones", "praline", "torro", "turron", "marsapa", "mazapan", "fruits secs", "frutos secos"], except: ["nou moscada", "nuez moscada"] },
  { id: "api", label: "Api", emoji: "🥬", words: ["api", "apio", "sal d'api"] },
  { id: "mostassa", label: "Mostassa", emoji: "🟡", words: ["mostassa", "mostaza", "mostarda"] },
  { id: "sesam", label: "Sèsam", emoji: "⚪", words: ["sesam", "sesamo", "tahina", "tahini", "ajonjoli"] },
  { id: "sulfits", label: "Sulfits", emoji: "🍷", words: ["vi", "vino", "vinagre", "cava", "xerez", "jerez", "conyac", "brandi", "fruita seca deshidratada", "panses", "pasas", "orellanes", "albercoc sec"] },
  { id: "tramussos", label: "Tramussos", emoji: "🫛", words: ["tramus", "tramussos", "altramuz", "altramuces", "farina de tramus"] },
  { id: "molluscs", label: "Mol·luscs", emoji: "🦑", words: ["musclo", "musclos", "mejillon", "calamar", "calamars", "sipia", "sepia", "pop", "pulpo", "cloissa", "cloisses", "almeja", "ostra", "ostres", "navalla", "navaja", "petxina", "vieira", "berberecho", "escopinya", "cargol", "caracol", "xipiro", "chipiron"] },
];

const BY_ID = new Map(ALLERGENS.map((a) => [a.id, a]));

export function allergenInfo(id: string): Allergen | null {
  return BY_ID.get(id) ?? null;
}

function hasWord(hay: string, word: string): boolean {
  const w = normalizeText(word);
  return new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(hay);
}

/**
 * Un ingredient conté aquesta al·lèrgia o preferència? Si és un dels
 * al·lèrgens coneguts, es busquen les seves paraules; si no, es compara amb el
 * nom de l'ingredient («ceba» coincideix amb «ceba tendra» i «cebes»).
 */
export function ingredientMatches(ingredient: string, item: string): boolean {
  const hay = normalizeText(ingredient);
  const allergen = BY_ID.get(item);
  if (allergen) {
    if (allergen.except?.some((x) => hay.includes(normalizeText(x)))) return false;
    return allergen.words.some((w) => hasWord(hay, w));
  }
  const want = ingredientKey(item);
  if (!want) return false;
  const key = ingredientKey(ingredient);
  return key === want || hasWord(` ${key} `, want) || hasWord(hay, normalizeText(item));
}

export interface DietPerson {
  user_id: string;
  display_name: string | null;
  allergies?: string[] | null;
  avoid?: string[] | null;
}

export interface DietConflict {
  userId: string;
  person: string;
  kind: "allergia" | "no_menja";
  /** al·lergen o ingredient tal com l'ha escrit la persona */
  item: string;
  label: string;
  ingredients: string[];
}

/** Conflictes d'una llista d'ingredients amb les preferències de la família */
export function findConflicts(ingredients: string[], people: DietPerson[]): DietConflict[] {
  const out: DietConflict[] = [];
  for (const p of people) {
    const person = p.display_name?.trim() || "Algú de casa";
    for (const [kind, list] of [
      ["allergia", p.allergies ?? []],
      ["no_menja", p.avoid ?? []],
    ] as const) {
      for (const item of list) {
        const hits = [...new Set(ingredients.filter((i) => ingredientMatches(i, item)))];
        if (!hits.length) continue;
        out.push({ userId: p.user_id, person, kind, item, label: allergenInfo(item)?.label ?? item, ingredients: hits });
      }
    }
  }
  // Primer les al·lèrgies
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "allergia" ? -1 : 1));
}

/** Tots els noms d'ingredients d'una recepta, inclosos els dels preelaborats */
export function recipeIngredientNames(
  recipeId: string,
  recipes: Map<string, { ingredients: { name: string; optional?: boolean; sub_recipe_id?: string | null }[] }>,
  includeOptional = true,
): string[] {
  const names: string[] = [];
  const walk = (id: string, seen: Set<string>) => {
    const r = recipes.get(id);
    if (!r) return;
    for (const i of r.ingredients) {
      if (i.optional && !includeOptional) continue;
      names.push(i.name);
      if (i.sub_recipe_id && !seen.has(i.sub_recipe_id) && seen.size < 6) walk(i.sub_recipe_id, new Set([...seen, i.sub_recipe_id]));
    }
  };
  walk(recipeId, new Set([recipeId]));
  return names;
}

/** Text curt per a un avís: «Anna: gluten (farina) · Pau no menja ceba» */
export function conflictSummary(conflicts: DietConflict[]): string {
  return conflicts
    .map((c) => (c.kind === "allergia" ? `${c.person}: al·lèrgia a ${c.label.toLowerCase()} (${c.ingredients.join(", ")})` : `${c.person} no menja ${c.label}`))
    .join(" · ");
}

/** Llegeix una llista escrita a mà: «ceba, pebrot; coriandre» */
export function parseList(text: string): string[] {
  return [...new Set(text.split(/[,;\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
}
