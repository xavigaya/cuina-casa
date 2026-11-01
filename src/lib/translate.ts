/**
 * Detecció d'idioma (castellà o català) per a receptes. Funciona amb paraules
 * i grafies característiques de cada llengua; n'hi ha prou per decidir si cal traduir.
 */
import { normalizeText } from "./sections";

const ES_WORDS = new Set([
  "y", "los", "las", "del", "con", "una", "unos", "unas", "para", "hasta", "muy", "pero", "cuando", "luego", "despues",
  "cebolla", "aceite", "huevo", "huevos", "pimienta", "ajo", "ajos", "cucharada", "cucharadas", "cucharadita", "cucharaditas",
  "añadir", "añade", "añadimos", "cocinar", "cocinamos", "hervir", "minutos", "fuego", "sarten", "olla", "horno", "agua",
  "receta", "pollo", "carne", "pescado", "verduras", "tomate", "tomates", "patatas", "queso", "leche", "harina", "azucar",
  "mantequilla", "limon", "lentejas", "garbanzos", "pimiento", "zanahoria", "calabacin", "cortar", "cortamos", "picar",
  "mezclar", "mezclamos", "dejar", "dejamos", "servir", "servimos", "tambien", "nuestro", "nuestra", "pizca", "trozos",
]);

const CA_WORDS = new Set([
  "i", "els", "les", "amb", "per", "fins", "molt", "pero", "quan", "despres", "ceba", "oli", "ou", "ous", "pebre", "all",
  "alls", "cullerada", "cullerades", "culleradeta", "afegir", "afegiu", "afegim", "coure", "bullir", "minuts", "foc",
  "cassola", "forn", "aigua", "recepta", "pollastre", "carn", "peix", "verdures", "tomaquet", "tomaquets", "patates",
  "formatge", "llet", "farina", "sucre", "mantega", "llimona", "llenties", "cigrons", "pebrot", "pastanaga", "carbasso",
  "tallar", "tallem", "barrejar", "barregem", "deixar", "deixem", "servir", "tambe", "nostre", "nostra", "pessic", "trossos",
]);

/** Puntuació de castellà i català d'un text. */
export function languageScores(text: string): { es: number; ca: number } {
  let es = 0;
  let ca = 0;
  const lower = text.toLowerCase();
  // Grafies exclusives
  es += (lower.match(/ñ/g)?.length ?? 0) * 2;
  es += (lower.match(/ción\b|ciones\b/g)?.length ?? 0) * 2;
  ca += (lower.match(/[àèò]|ç|l·l|ny\b/g)?.length ?? 0) * 2;
  ca += (lower.match(/ció\b|cions\b|\b[dlsmnt]'[a-zàèéíòóú]/g)?.length ?? 0) * 2;
  for (const w of normalizeText(text).replace(/[^a-zñ0-9 ]/g, " ").split(" ")) {
    if (!w) continue;
    if (ES_WORDS.has(w)) es++;
    if (CA_WORDS.has(w)) ca++;
  }
  return { es, ca };
}

/** El text sembla castellà (i no català)? */
export function looksSpanish(text: string): boolean {
  const { es, ca } = languageScores(text);
  return es >= 2 && es > ca * 1.3;
}
