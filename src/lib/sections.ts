/**
 * Seccions del supermercat, en l'ordre en què normalment es recorre la botiga.
 * La llista de la compra s'agrupa i s'ordena seguint aquest ordre.
 */
export type SectionId =
  | "fruita"
  | "forn"
  | "carn"
  | "peix"
  | "lactics"
  | "xarcuteria"
  | "rebost"
  | "conserves"
  | "especies"
  | "begudes"
  | "congelats"
  | "neteja"
  | "higiene"
  | "altres";

export interface Section {
  id: SectionId;
  label: string;
  emoji: string;
  keywords: string[];
}

export const SECTIONS: Section[] = [
  {
    id: "fruita",
    label: "Fruita i verdura",
    emoji: "🥬",
    keywords: [
      "poma", "pera", "plàtan", "platan", "taronja", "mandarina", "llimona", "maduixa", "raïm", "raim",
      "préssec", "presec", "meló", "melo", "síndria", "sindria", "kiwi", "pinya", "alvocat", "aguacate",
      "tomàquet", "tomaquet", "tomate", "ceba", "cebolla", "all ", "ajo", "pastanaga", "zanahoria",
      "patata", "enciam", "lechuga", "pebrot", "pimiento", "carbassó", "carbasso", "calabacín",
      "albergínia", "alberginia", "cogombre", "pepino", "espinac", "bròquil", "broquil", "brócoli",
      "coliflor", "col ", "porro", "puerro", "api", "apio", "carbassa", "calabaza", "bolet", "xampinyó",
      "champiñón", "seta", "julivert", "perejil", "alfàbrega", "albahaca", "coriandre", "menta",
      "gingebre", "jengibre", "mongeta tendra", "judía verde", "fruita", "verdura", "remolatxa",
    ],
  },
  {
    id: "forn",
    label: "Forn i pa",
    emoji: "🥖",
    keywords: ["pa ", "pan ", "barra", "baguette", "pa de motlle", "brioix", "croissant", "magdalena", "galeta", "galleta", "torrada", "biscote"],
  },
  {
    id: "carn",
    label: "Carn",
    emoji: "🥩",
    keywords: [
      "pollastre", "pollo", "vedella", "ternera", "porc", "cerdo", "xai", "cordero", "conill", "conejo",
      "carn", "carne", "hamburguesa", "botifarra", "butifarra", "salsitxa", "salchicha", "llom", "lomo",
      "costella", "costilla", "pit de", "pechuga", "cuixa", "muslo", "picada", "gall dindi", "pavo",
    ],
  },
  {
    id: "peix",
    label: "Peix i marisc",
    emoji: "🐟",
    keywords: [
      "peix", "pescado", "salmó", "salmon", "salmón", "lluç", "merluza", "bacallà", "bacalao", "tonyina fresca",
      "sardina", "seitó", "boquerón", "calamar", "sípia", "sepia", "gamba", "gamba", "llagostí", "langostino",
      "musclo", "mejillón", "cloïssa", "almeja", "rap", "rape", "orada", "dorada", "llobarro", "lubina", "pop", "pulpo",
    ],
  },
  {
    id: "lactics",
    label: "Làctics i ous",
    emoji: "🥛",
    keywords: ["llet", "leche", "iogurt", "yogur", "formatge", "queso", "mantega", "mantequilla", "nata", "crema de llet", "ou ", "ous", "huevo", "mató", "requesón", "kefir", "quark"],
  },
  {
    id: "xarcuteria",
    label: "Xarcuteria",
    emoji: "🥓",
    keywords: ["pernil", "jamón", "jamon", "fuet", "llonganissa", "chorizo", "xoriço", "bacó", "bacon", "beicon", "mortadel·la", "mortadela", "salami", "sobrassada", "sobrasada", "embotit"],
  },
  {
    id: "rebost",
    label: "Rebost",
    emoji: "🍝",
    keywords: [
      "arròs", "arroz", "pasta", "macarron", "espaguet", "fideu", "fideo", "farina", "harina", "sucre", "azúcar",
      "azucar", "oli", "aceite", "vinagre", "llegum", "cigró", "garbanzo", "llentia", "lenteja", "mongeta seca",
      "alubia", "cereal", "civada", "avena", "cacau", "cafè", "café", "te ", "infusió", "mel", "miel",
      "melmelada", "mermelada", "fruits secs", "nous", "nueces", "ametlla", "almendra", "llevat", "levadura",
      "brou", "caldo", "pa ratllat", "pan rallado", "cuscús", "quinoa", "xocolata", "chocolate",
    ],
  },
  {
    id: "conserves",
    label: "Conserves i salses",
    emoji: "🥫",
    keywords: ["tonyina", "atún", "atun", "tomàquet triturat", "tomate triturado", "tomàquet fregit", "tomate frito", "conserva", "llauna", "lata", "olives", "aceitunas", "maionesa", "mayonesa", "quètxup", "ketchup", "mostassa", "mostaza", "salsa", "pot de", "bote"],
  },
  {
    id: "especies",
    label: "Espècies",
    emoji: "🧂",
    keywords: ["sal", "pebre", "pimienta", "pebre vermell", "pimentón", "comí", "comino", "orenga", "orégano", "farigola", "tomillo", "romaní", "romero", "canyella", "canela", "llorer", "laurel", "nou moscada", "nuez moscada", "curri", "curry", "safrà", "azafrán", "espècies", "especias"],
  },
  {
    id: "begudes",
    label: "Begudes",
    emoji: "🧃",
    keywords: ["aigua", "agua", "suc", "zumo", "refresc", "refresco", "cervesa", "cerveza", "vi ", "vino", "cava", "beguda", "bebida"],
  },
  {
    id: "congelats",
    label: "Congelats",
    emoji: "🧊",
    keywords: ["congelat", "congelado", "gelat", "helado", "pèsols congelats", "guisantes congelados", "pizza", "croquetes", "croquetas", "glaçons", "hielo"],
  },
  {
    id: "neteja",
    label: "Neteja",
    emoji: "🧽",
    keywords: ["detergent", "detergente", "lleixiu", "lejía", "suavitzant", "suavizante", "rentavaixelles", "lavavajillas", "fregall", "estropajo", "bossa d'escombraries", "bolsas de basura", "paper de cuina", "papel de cocina", "paper film", "paper d'alumini", "netejador", "limpiador"],
  },
  {
    id: "higiene",
    label: "Higiene",
    emoji: "🧴",
    keywords: ["xampú", "champú", "gel de dutxa", "gel de ducha", "sabó", "jabón", "pasta de dents", "pasta de dientes", "raspall", "cepillo", "desodorant", "desodorante", "paper higiènic", "papel higiénico", "compreses", "compresas", "bolquers", "pañales", "tovalloletes", "toallitas", "crema"],
  },
  { id: "altres", label: "Altres", emoji: "🛒", keywords: [] },
];

export const SECTION_BY_ID: Record<SectionId, Section> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s]),
) as Record<SectionId, Section>;

export const SECTION_ORDER: Record<string, number> = Object.fromEntries(
  SECTIONS.map((s, i) => [s.id, i]),
);

export function sectionInfo(id: string | null | undefined): Section {
  return SECTION_BY_ID[(id ?? "altres") as SectionId] ?? SECTION_BY_ID.altres;
}

/**
 * Endevina la secció d'un producte a partir del nom (català o castellà).
 * Les paraules clau més llargues tenen prioritat, perquè "tomàquet triturat"
 * guanyi a "tomàquet".
 */
export function guessSection(name: string): SectionId {
  const cleaned = normalizeText(name).replace(/[^a-z0-9' ]/g, " ");
  // Busquem tant al text original com en singular ("cebes" → "ceba")
  const haystack = ` ${cleaned} ${cleaned.split(" ").map(singularize).join(" ")} `;
  let best: { id: SectionId; len: number } | null = null;
  for (const section of SECTIONS) {
    for (const kw of section.keywords) {
      const needle = normalizeText(kw);
      // Paraules curtes ("sal", "mel", "pa") han de coincidir com a paraula sencera
      const padded = kw.endsWith(" ") || needle.length <= 3 ? ` ${needle} ` : needle;
      if (haystack.includes(padded)) {
        if (!best || needle.length > best.len) best = { id: section.id, len: needle.length };
      }
    }
  }
  return best?.id ?? "altres";
}

/** Minúscules, sense accents ni espais repetits. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/·/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Singular aproximat per a paraules catalanes/castellanes ja normalitzades. */
export function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ques")) return word.slice(0, -4) + "ca"; // vaques → vaca
  if (word.endsWith("gues")) return word.slice(0, -4) + "ga"; // pastanagues → pastanaga
  if (word.endsWith("ces")) return word.slice(0, -3) + "ca";
  if (word.endsWith("es") && word.length > 4) {
    const stem = word.slice(0, -2);
    return /[^aeiou]$/.test(stem) ? stem + "a" : stem; // cebes → ceba
  }
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}
