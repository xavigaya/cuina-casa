/**
 * Comparació amb el Plat de Harvard (Harvard T.H. Chan School of Public Health):
 *   ½ verdura i fruita (les patates no compten), ¼ cereals (millor integrals), ¼ proteïna saludable.
 * És una aproximació orientativa, no un consell mèdic.
 */
import type { HarvardGroup, PlateGrams } from "./nutrition";

export interface PlateShares {
  /** Grams al plat que compten per a la comparació */
  total: number;
  vegFruit: number;
  grains: number;
  protein: number;
  /** Part dels cereals i fècules que és refinada (inclou la patata) */
  refinedOfGrains: number;
  potato: number;
}

const VEG: HarvardGroup[] = ["verdura", "fruita"];
const GRAINS: HarvardGroup[] = ["cereal_integral", "cereal_refinat", "patata"];
const PROTEIN: HarvardGroup[] = ["llegum", "peix", "ou", "aviram", "carn_vermella", "carn_processada", "fruits_secs", "lactic"];

const sum = (p: PlateGrams, groups: HarvardGroup[]) => groups.reduce((acc, g) => acc + (p[g] ?? 0), 0);

export function plateShares(p: PlateGrams): PlateShares {
  const veg = sum(p, VEG);
  const grains = sum(p, GRAINS);
  const protein = sum(p, PROTEIN);
  const total = veg + grains + protein;
  const refined = (p.cereal_refinat ?? 0) + (p.patata ?? 0);
  return {
    total,
    vegFruit: total ? veg / total : 0,
    grains: total ? grains / total : 0,
    protein: total ? protein / total : 0,
    refinedOfGrains: grains ? refined / grains : 0,
    potato: total ? (p.patata ?? 0) / total : 0,
  };
}

export type PlateStatus = "equilibrat" | "millorable" | "desequilibrat" | "no_avaluable";

export interface Advice {
  code:
    | "falta_verdura" | "patates" | "massa_cereal" | "millor_integral" | "falta_proteina"
    | "massa_proteina" | "carn_processada" | "carn_vermella" | "equilibrat";
  text: string;
}

export interface PlateEvaluation {
  shares: PlateShares;
  /** 0-100: com s'assembla al plat ideal */
  score: number;
  status: PlateStatus;
  advice: Advice[];
}

/** Menys d'aquests grams al plat (postres, salses…) no permet comparar-ho. */
export const MIN_PLATE_GRAMS = 40;

export function evaluatePlate(p: PlateGrams): PlateEvaluation {
  const shares = plateShares(p);
  if (shares.total < MIN_PLATE_GRAMS) {
    return { shares, score: 0, status: "no_avaluable", advice: [] };
  }
  const deviation =
    Math.abs(shares.vegFruit - 0.5) + Math.abs(shares.grains - 0.25) + Math.abs(shares.protein - 0.25);
  const score = Math.max(0, Math.round(100 - (deviation / 1.5) * 100));

  const advice: Advice[] = [];
  if (shares.vegFruit < 0.35) {
    advice.push({ code: "falta_verdura", text: "Hi falta verdura" });
    if (shares.potato >= 0.15) advice.push({ code: "patates", text: "Les patates no compten com a verdura" });
  }
  if (shares.grains > 0.4) advice.push({ code: "massa_cereal", text: "Massa cereals o fècules" });
  if (shares.grains >= 0.1 && shares.refinedOfGrains > 0.6 && (p.cereal_refinat ?? 0) > 0) {
    advice.push({ code: "millor_integral", text: "Millor pasta, arròs o pa integrals" });
  }
  if (shares.protein < 0.12) advice.push({ code: "falta_proteina", text: "Hi falta proteïna" });
  if (shares.protein > 0.45) advice.push({ code: "massa_proteina", text: "Massa proteïna: millor més verdura" });
  if ((p.carn_processada ?? 0) > 10) {
    advice.push({ code: "carn_processada", text: "Embotits i carn processada, millor de tant en tant" });
  } else if ((p.carn_vermella ?? 0) > 10) {
    advice.push({ code: "carn_vermella", text: "Carn vermella, amb moderació" });
  }

  const serious = advice.filter((a) => ["falta_verdura", "massa_cereal", "falta_proteina", "massa_proteina"].includes(a.code));
  const status: PlateStatus = serious.length === 0 && score >= 70 ? "equilibrat" : score >= 50 && serious.length <= 1 ? "millorable" : "desequilibrat";
  if (advice.length === 0) advice.push({ code: "equilibrat", text: "Ben equilibrat" });
  return { shares, score, status, advice };
}

// ---------------------------------------------------------------------------
// Varietat de proteïnes al llarg de la setmana
// ---------------------------------------------------------------------------

export type ProteinKind = "peix" | "llegum" | "ou" | "aviram" | "carn_vermella";

export const PROTEIN_KINDS: { id: ProteinKind; label: string; min?: number; max?: number }[] = [
  { id: "peix", label: "Peix", min: 2 },
  { id: "llegum", label: "Llegums", min: 2 },
  { id: "ou", label: "Ous", max: 4 },
  { id: "aviram", label: "Aviram", max: 4 },
  { id: "carn_vermella", label: "Carn vermella", max: 2 },
];

/** Grams per ració a partir dels quals un plat «compta» com a ració d'aquella proteïna. */
const PROTEIN_SERVING_G = 25;

/** Tipus de proteïna principal d'un plat (si en té). */
export function proteinKinds(p: PlateGrams): ProteinKind[] {
  const kinds: ProteinKind[] = [];
  if ((p.peix ?? 0) >= PROTEIN_SERVING_G) kinds.push("peix");
  if ((p.llegum ?? 0) >= PROTEIN_SERVING_G) kinds.push("llegum");
  if ((p.ou ?? 0) >= PROTEIN_SERVING_G) kinds.push("ou");
  if ((p.aviram ?? 0) >= PROTEIN_SERVING_G) kinds.push("aviram");
  if ((p.carn_vermella ?? 0) + (p.carn_processada ?? 0) >= PROTEIN_SERVING_G) kinds.push("carn_vermella");
  return kinds;
}

/** Proteïnes de les quals encara no s'ha arribat al mínim setmanal recomanat. */
export function missingProteinKinds(counts: Record<ProteinKind, number>): ProteinKind[] {
  return PROTEIN_KINDS.filter((k) => k.min && counts[k.id] < k.min).map((k) => k.id);
}

export function countProteins(plates: PlateGrams[]): Record<ProteinKind, number> {
  const counts: Record<ProteinKind, number> = { peix: 0, llegum: 0, ou: 0, aviram: 0, carn_vermella: 0 };
  for (const p of plates) for (const k of proteinKinds(p)) counts[k]++;
  return counts;
}

// ---------------------------------------------------------------------------
// Desequilibris i propostes compensatòries
// ---------------------------------------------------------------------------

export interface Imbalance {
  needVeg: boolean;
  tooMuchGrain: boolean;
  refined: boolean;
  needProtein: boolean;
  tooMuchProtein: boolean;
  missingProteins: ProteinKind[]; // varietat: el que falta a la setmana
  tooMuchRedMeat: boolean;
}

export function detectImbalance(p: PlateGrams, weekProteins?: Record<ProteinKind, number>): Imbalance | null {
  const shares = plateShares(p);
  const evaluable = shares.total >= MIN_PLATE_GRAMS;
  const imb: Imbalance = {
    needVeg: evaluable && shares.vegFruit < 0.4,
    tooMuchGrain: evaluable && shares.grains > 0.35,
    refined: evaluable && shares.grains >= 0.1 && shares.refinedOfGrains > 0.6 && (p.cereal_refinat ?? 0) > 0,
    needProtein: evaluable && shares.protein < 0.15,
    tooMuchProtein: evaluable && shares.protein > 0.4,
    missingProteins: weekProteins ? missingProteinKinds(weekProteins) : [],
    tooMuchRedMeat: weekProteins ? weekProteins.carn_vermella >= 2 : false,
  };
  const any = imb.needVeg || imb.tooMuchGrain || imb.refined || imb.needProtein || imb.tooMuchProtein || imb.missingProteins.length > 0;
  return any ? imb : null;
}

export function describeImbalance(imb: Imbalance, scope: "dia" | "setmana"): string {
  const when = scope === "dia" ? "Avui" : "Aquesta setmana";
  const parts: string[] = [];
  if (imb.needVeg) parts.push("has menjat poca verdura");
  if (imb.tooMuchGrain) parts.push(imb.refined ? "has menjat força cereal refinat" : "has menjat força cereal o fècula");
  else if (imb.refined) parts.push("els cereals han estat refinats");
  if (imb.needProtein) parts.push("t'ha faltat proteïna");
  if (imb.tooMuchProtein) parts.push("hi ha hagut molta proteïna");
  const missing = imb.missingProteins.map((k) => PROTEIN_KINDS.find((x) => x.id === k)!.label.toLowerCase());
  const variety = missing.length ? `encara falta ${joinCa(missing)}` : "";
  if (parts.length === 0 && variety) return `${when} ${variety}`;
  const text = `${when} ${joinCa(parts)}`;
  return variety ? `${text}, i ${variety}` : text;
}

export function joinCa(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} i ${items[items.length - 1]}`;
}

export interface Candidate {
  id: string;
  title: string;
  course: string | null;
  plate: PlateGrams; // per ració
}

export interface Proposal {
  recipes: { id: string; title: string }[];
  reason: string;
}

/** Puntua com de bé compensa un plat el desequilibri. */
export function compensationScore(c: Candidate, imb: Imbalance): number {
  const s = plateShares(c.plate);
  if (s.total < MIN_PLATE_GRAMS) return -Infinity;
  let score = 0;
  if (imb.needVeg) score += s.vegFruit * 3;
  if (imb.tooMuchGrain) score -= s.grains * 2.5;
  else score -= Math.abs(s.grains - 0.25);
  if (imb.refined) score += s.grains > 0 ? (1 - s.refinedOfGrains) * 1.5 : 0.5;
  if (imb.needProtein) score += s.protein * 2;
  if (imb.tooMuchProtein) score -= s.protein * 2;
  const kinds = proteinKinds(c.plate);
  for (const k of kinds) {
    if (imb.missingProteins.includes(k)) score += 1.2;
  }
  if (kinds.includes("carn_vermella")) score -= imb.tooMuchRedMeat ? 2 : 0.5;
  if ((c.plate.carn_processada ?? 0) > 10) score -= 1;
  // un petit premi per l'equilibri general
  score += evaluatePlate(c.plate).score / 200;
  return score;
}

const MAIN_COURSES = new Set(["primer", "segon", "plat_unic", "entrant"]);

/**
 * Proposa 1-3 opcions per compensar un desequilibri amb receptes guardades.
 * Si hi ha primers i segons, intenta proposar una combinació (p. ex. crema de verdura + peix).
 */
export function proposeCompensation(
  imb: Imbalance,
  candidates: Candidate[],
  scope: "dia" | "setmana",
  exclude: Set<string> = new Set(),
): Proposal[] {
  const pool = candidates
    .filter((c) => !exclude.has(c.id) && (c.course == null || MAIN_COURSES.has(c.course)))
    .map((c) => ({ c, score: compensationScore(c, imb) }))
    .filter((x) => Number.isFinite(x.score) && x.score > 0.2)
    .sort((a, b) => b.score - a.score);
  if (pool.length === 0) return [];

  const reason = describeImbalance(imb, scope);
  const proposals: Proposal[] = [];
  const used = new Set<string>();

  // Combinació primer + segon quan falta verdura i també proteïna o varietat
  const wantsCombo = imb.needVeg && (imb.needProtein || imb.missingProteins.length > 0);
  if (wantsCombo) {
    const primer = pool.find((x) => (x.c.course === "primer" || x.c.course === "entrant") && plateShares(x.c.plate).vegFruit >= 0.5);
    const segon = pool.find((x) => x.c.course === "segon" && plateShares(x.c.plate).protein >= 0.3 && x.c.id !== primer?.c.id);
    if (primer && segon) {
      proposals.push({ recipes: [primer.c, segon.c].map(({ id, title }) => ({ id, title })), reason });
      used.add(primer.c.id).add(segon.c.id);
    }
  }
  for (const { c } of pool) {
    if (proposals.length >= 3) break;
    if (used.has(c.id)) continue;
    proposals.push({ recipes: [{ id: c.id, title: c.title }], reason });
    used.add(c.id);
  }
  return proposals;
}
