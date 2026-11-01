import {
  countProteins, detectImbalance, evaluatePlate, missingProteinKinds, proposeCompensation,
  type Candidate, type Imbalance, type PlateEvaluation, type Proposal, type ProteinKind,
} from "./harvard";
import { ZERO, addNutrients, addPlate, scaleNutrients, type Nutrients, type NutritionResult, type PlateGrams } from "./nutrition";
import type { Meal } from "./types";

export interface MenuEntryLite {
  day: string;
  meal: Meal;
  recipe_id: string | null;
}

export interface DayAnalysis {
  day: string;
  /** Per persona, sumant els àpats planificats amb recepta */
  totals: Nutrients;
  plate: PlateGrams;
  /** Plats amb recepta comptats */
  counted: number;
  /** Plats sense recepta (només una nota) o sense dades */
  unknown: number;
  incomplete: boolean;
  /** Propostes per al sopar (si esmorzar + dinar estan desequilibrats i el sopar és buit) */
  proposals: Proposal[];
  imbalance: Imbalance | null;
}

export interface WeekendSlot {
  day: string;
  meal: Meal;
}

export interface WeekAnalysis {
  days: DayAnalysis[];
  average: Nutrients | null;
  daysWithData: number;
  plate: PlateGrams;
  evaluation: PlateEvaluation;
  proteins: Record<ProteinKind, number>;
  incomplete: boolean;
  weekend: { proposals: Proposal[]; imbalance: Imbalance | null; slots: WeekendSlot[] };
}

/**
 * Analitza una setmana de menú: totals per persona i dia, mitjana, balanç de
 * proteïnes i propostes per compensar (sopar del dia i cap de setmana).
 */
export function analyzeWeek(
  entries: MenuEntryLite[],
  days: string[],
  todayISO: string,
  nutritionOf: (recipeId: string) => NutritionResult | null,
  candidates: Candidate[],
): WeekAnalysis {
  const proteinsPlates: PlateGrams[] = [];
  let weekPlate: PlateGrams = {};
  let weekIncomplete = false;

  const dayData = days.map((day) => {
    const list = entries.filter((e) => e.day === day);
    let totals = ZERO;
    let plate: PlateGrams = {};
    let morning: PlateGrams = {};
    let counted = 0;
    let unknown = 0;
    let incomplete = false;
    for (const e of list) {
      const res = e.recipe_id ? nutritionOf(e.recipe_id) : null;
      if (!res) {
        unknown++;
        continue;
      }
      counted++;
      totals = addNutrients(totals, res.perServing);
      plate = addPlate(plate, res.plate);
      if (e.meal !== "sopar") morning = addPlate(morning, res.plate);
      if (res.incomplete) incomplete = true;
      proteinsPlates.push(res.plate);
    }
    weekPlate = addPlate(weekPlate, plate);
    if (incomplete || unknown) weekIncomplete = true;
    return { day, list, totals, plate, morning, counted, unknown, incomplete };
  });

  const proteins = countProteins(proteinsPlates);
  const usedThisWeek = new Set(entries.map((e) => e.recipe_id).filter(Boolean) as string[]);

  const analyses: DayAnalysis[] = dayData.map((d) => {
    let proposals: Proposal[] = [];
    let imbalance: Imbalance | null = null;
    const hasMorning = d.list.some((e) => e.meal !== "sopar" && e.recipe_id);
    const dinnerEmpty = !d.list.some((e) => e.meal === "sopar");
    if (d.day >= todayISO && hasMorning && dinnerEmpty) {
      imbalance = detectImbalance(d.morning);
      if (imbalance) {
        // La varietat de la setmana no dispara propostes per si sola, però les orienta
        imbalance = { ...imbalance, missingProteins: missingProteinKinds(proteins), tooMuchRedMeat: proteins.carn_vermella >= 2 };
        const exclude = new Set(d.list.map((e) => e.recipe_id).filter(Boolean) as string[]);
        proposals = proposeCompensation(imbalance, candidates, "dia", exclude);
      }
    }
    return {
      day: d.day,
      totals: d.totals,
      plate: d.plate,
      counted: d.counted,
      unknown: d.unknown,
      incomplete: d.incomplete,
      proposals,
      imbalance,
    };
  });

  const withData = analyses.filter((a) => a.counted > 0);
  const average = withData.length
    ? scaleNutrients(withData.reduce((acc, a) => addNutrients(acc, a.totals), ZERO), 1 / withData.length)
    : null;

  // Cap de setmana: balanç setmanal i propostes per als àpats buits de dissabte i diumenge
  const weekendDays = days.slice(5).filter((d) => d >= todayISO);
  const slots: WeekendSlot[] = [];
  for (const day of weekendDays) {
    for (const meal of ["dinar", "sopar"] as Meal[]) {
      if (!entries.some((e) => e.day === day && e.meal === meal)) slots.push({ day, meal });
    }
  }
  let weekendProposals: Proposal[] = [];
  let weekendImbalance: Imbalance | null = null;
  if (slots.length && proteinsPlates.length >= 3) {
    weekendImbalance = detectImbalance(weekPlate, proteins);
    if (weekendImbalance) weekendProposals = proposeCompensation(weekendImbalance, candidates, "setmana", usedThisWeek);
  }

  return {
    days: analyses,
    average,
    daysWithData: withData.length,
    plate: weekPlate,
    evaluation: evaluatePlate(weekPlate),
    proteins,
    incomplete: weekIncomplete,
    weekend: { proposals: weekendProposals, imbalance: weekendImbalance, slots },
  };
}
