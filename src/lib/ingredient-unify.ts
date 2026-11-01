/**
 * Detecció de noms d'ingredients que probablement són el mateix producte
 * («ceba» i «ceba dolça», «julivert» i «fulles de julivert», «cebes» i «Ceba»…),
 * per proposar d'unificar-los en un sol nom.
 */
import { foodKey, type FoodIndex } from "./nutrition";

export type RefTable = "recipe_ingredients" | "pantry_items" | "shopping_items";

export interface NameUse {
  name: string;
  /** Receptes on apareix (títols) */
  recipes: string[];
  refs: { table: RefTable; id: string }[];
}

export interface UnifyMember extends NameUse {
  key: string;
  count: number;
}

export interface UnifyProposal {
  /** Identificador estable del grup (per poder-lo ignorar) */
  id: string;
  /** Nom que es proposa conservar */
  target: string;
  members: UnifyMember[];
  reason: "grafia" | "variant" | "errata";
}

const STOP = new Set(["de", "del", "d", "la", "el", "les", "els", "amb", "i", "a", "al"]);

function words(key: string): string[] {
  return key.replace(/'/g, " ").split(" ").filter((w) => w && !STOP.has(w));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** El nom més llarg és una variant del curt? («fulles de julivert» ⊃ «julivert») */
function isVariant(short: string[], long: string[]): boolean {
  if (!short.length || short.length >= long.length) return false;
  if (!short.some((w) => w.length >= 3)) return false;
  if (long.length - short.length > 3) return false;
  return short.every((w) => long.includes(w));
}

/** Mateix nombre de paraules i una sola paraula amb una errata («julivet» / «julivert»). */
function isTypo(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  let diffs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (a[i].length < 5 || b[i].length < 5 || levenshtein(a[i], b[i]) > 1) return false;
    diffs++;
  }
  return diffs === 1;
}

/**
 * Busca grups de noms semblants. No proposa ajuntar dos noms que la taula
 * d'aliments coneix com a aliments diferents (p. ex. «ceba» i «ceba tendra»).
 */
export function findSimilarNames(uses: NameUse[], index: FoodIndex | null): UnifyProposal[] {
  // 1. Agrupa per clau exacta (majúscules, accents, plurals)
  const byKey = new Map<string, UnifyMember[]>();
  for (const u of uses) {
    const key = foodKey(u.name);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    const same = list.find((m) => m.name.trim().toLowerCase() === u.name.trim().toLowerCase());
    if (same) {
      same.refs.push(...u.refs);
      same.recipes = [...new Set([...same.recipes, ...u.recipes])];
      same.count = same.refs.length;
    } else {
      list.push({ ...u, name: u.name.trim(), key, count: u.refs.length });
    }
    byKey.set(key, list);
  }
  const keys = [...byKey.keys()];

  const distinctFoods = (a: string, b: string) => {
    if (!index) return false;
    const fa = index.byKey.get(a);
    const fb = index.byKey.get(b);
    return !!fa && !!fb && fa.id !== fb.id;
  };

  // 2. Uneix claus semblants (unió-cerca)
  const parent = new Map(keys.map((k) => [k, k]));
  const reasons = new Map<string, UnifyProposal["reason"]>();
  const find = (k: string): string => {
    while (parent.get(k) !== k) k = parent.get(k)!;
    return k;
  };
  const union = (a: string, b: string, reason: UnifyProposal["reason"]) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
    const root = find(a);
    if (reasons.get(root) !== "variant") reasons.set(root, reason);
  };
  const wordCache = new Map(keys.map((k) => [k, words(k)]));
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      if (distinctFoods(a, b)) continue;
      const wa = wordCache.get(a)!;
      const wb = wordCache.get(b)!;
      if (isVariant(wa, wb) || isVariant(wb, wa)) union(a, b, "variant");
      else if (isTypo(wa, wb)) union(a, b, "errata");
    }
  }

  // 3. Construeix les propostes
  const clusters = new Map<string, string[]>();
  for (const k of keys) {
    const r = find(k);
    clusters.set(r, [...(clusters.get(r) ?? []), k]);
  }
  const proposals: UnifyProposal[] = [];
  for (const [root, ks] of clusters) {
    const members = ks.flatMap((k) => byKey.get(k)!);
    if (members.length < 2) continue;
    // Es proposa conservar el nom més utilitzat (i, si hi ha empat, el més curt)
    const target = [...members].sort((a, b) => b.count - a.count || a.name.length - b.name.length)[0];
    proposals.push({
      id: [...new Set(ks)].sort().join("|"),
      target: target.name,
      members: members.sort((a, b) => (a.name === target.name ? -1 : b.name === target.name ? 1 : b.count - a.count)),
      reason: ks.length === 1 ? "grafia" : reasons.get(root) ?? "variant",
    });
  }
  return proposals.sort((a, b) => b.members.reduce((s, m) => s + m.count, 0) - a.members.reduce((s, m) => s + m.count, 0));
}
