import type { Permissions } from "./permissions";

/** Una fila de la taula activity_log (migració 0005) */
export interface ActivityEntry {
  id: number;
  household_id: string;
  user_id: string | null;
  at: string;
  table_name: string;
  row_id: string | null;
  action: "insert" | "update" | "delete";
  label: string | null;
  old_data: Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  new_data: Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  tx: number;
  undone_at: string | null;
  undone_by: string | null;
}

export type ActivityArea = "receptes" | "menu" | "llista" | "rebost" | "aliments" | "llar";

export const AREA_OF: Record<string, ActivityArea> = {
  recipes: "receptes",
  meal_plan: "menu",
  shopping_items: "llista",
  pantry_items: "rebost",
  foods: "aliments",
  households: "llar",
  household_members: "llar",
};

export const AREA_LABEL: Record<ActivityArea, string> = {
  receptes: "Receptes",
  menu: "Menú",
  llista: "Llista",
  rebost: "Rebost",
  aliments: "Aliments",
  llar: "Llar",
};

/** Les taules que undo_actions sap desfer */
export const UNDOABLE = new Set(["recipes", "meal_plan", "shopping_items", "pantry_items", "foods"]);

const MEAL_NAME: Record<string, string> = { esmorzar: "esmorzar", dinar: "dinar", sopar: "sopar" };
const LOCATION_LABEL: Record<string, string> = { rebost: "al rebost", nevera: "a la nevera", congelador: "al congelador" };
const LOCATION_FROM: Record<string, string> = { rebost: "del rebost", nevera: "de la nevera", congelador: "del congelador" };

function q(s: string | null | undefined): string {
  return `«${s?.trim() || "sense nom"}»`;
}

/** «al dinar del dilluns 2/11», «de l'esmorzar…», «per al sopar…» (amb les contraccions) */
function mealWhen(row: Record<string, unknown> | null | undefined, prep: "a" | "de" | "per a"): string {
  if (!row) return "";
  const name = MEAL_NAME[String(row.meal)];
  const meal = !name
    ? `${prep} un àpat`
    : name === "esmorzar"
      ? `${prep} l'esmorzar`
      : `${prep === "a" ? "al" : prep === "de" ? "del" : "per al"} ${name}`;
  const day = String(row.day ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return meal;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  let weekday = "";
  try {
    weekday = date.toLocaleDateString("ca", { weekday: "long" });
  } catch {}
  return `${meal} del ${weekday ? weekday + " " : ""}${Number(m[3])}/${Number(m[2])}`;
}

/** Text de l'acció, sense el nom de qui l'ha fet: «ha afegit "llet" a la llista». */
export function describeEntry(e: ActivityEntry): string {
  const o = e.old_data;
  const n = e.new_data;
  const name = q(e.label);
  switch (e.table_name) {
    case "recipes": {
      const before = (o?.row ?? null) as Record<string, unknown> | null;
      if (e.action === "insert") return n?.status === "proposta" ? `ha proposat la recepta ${name}` : `ha afegit la recepta ${name}`;
      if (e.action === "update") {
        if (before?.status === "proposta" && n?.status === "aprovada") return `ha aprovat la recepta ${name}`;
        if (before && before.title !== n?.title && before.title) return `ha editat la recepta ${q(String(before.title))} (ara ${name})`;
        return `ha editat la recepta ${name}`;
      }
      if (before?.status === "proposta" && before.created_by !== e.user_id) return `ha rebutjat la proposta de recepta ${name}`;
      return `ha esborrat la recepta ${name}`;
    }
    case "meal_plan": {
      if (e.action === "insert") return n?.status === "proposta" ? `ha proposat ${name} per ${mealWhen(n, "a")}` : `ha afegit ${name} ${mealWhen(n, "a")}`;
      if (e.action === "update") {
        if (o?.status === "proposta" && n?.status === "aprovada") return `ha aprovat ${name} per ${mealWhen(n, "a")}`;
        if (o && n && (o.day !== n.day || o.meal !== n.meal)) return `ha mogut ${name} ${mealWhen(n, "a")}`;
        if (o && n && o.recipe_id !== n.recipe_id && n.recipe_id) return `ha enllaçat el plat ${mealWhen(n, "de")} amb la recepta ${name}`;
        return `ha canviat ${name} ${mealWhen(n, "de")}`;
      }
      if (o?.status === "proposta" && o.created_by !== e.user_id) return `ha rebutjat la proposta ${name} ${mealWhen(o, "per a")}`;
      return `ha tret ${name} ${mealWhen(o, "de")}`;
    }
    case "shopping_items": {
      if (e.action === "insert") return `ha afegit ${name} a la llista`;
      if (e.action === "update") {
        if (o && n && !o.checked && n.checked) return `ha comprat ${name}`;
        if (o && n && o.checked && !n.checked) return `ha desmarcat ${name} de comprat`;
        return `ha editat ${name} de la llista`;
      }
      return `ha tret ${name} de la llista`;
    }
    case "pantry_items": {
      const loc = String((n ?? o)?.location ?? "rebost");
      if (e.action === "insert") return `ha afegit ${name} ${LOCATION_LABEL[loc] ?? "al rebost"}`;
      if (e.action === "update") {
        if (o && n && o.location !== n.location) return `ha mogut ${name} ${LOCATION_LABEL[loc] ?? ""}`.trim();
        if (o && n && o.quantity !== n.quantity) return `ha canviat la quantitat de ${name}`;
        return `ha editat ${name} ${LOCATION_FROM[loc] ?? "del rebost"}`;
      }
      return `ha tret ${name} ${LOCATION_FROM[loc] ?? "del rebost"}`;
    }
    case "foods":
      if (e.action === "insert") return `ha afegit l'aliment ${name}`;
      if (e.action === "update") return `ha corregit l'aliment ${name}`;
      return `ha esborrat l'aliment ${name}`;
    case "households":
      if (e.action === "insert") return `ha creat la llar ${name}`;
      return "ha canviat els ajustos de la llar";
    case "household_members":
      if (e.action === "insert") return "s'ha unit a la llar";
      if (e.action === "delete") return "ha sortit de la llar";
      if (o && n && o.role !== n.role) return `ha fet ${n.role === "owner" ? "privilegiat" : "col·laborador"} ${name}`;
      return `ha canviat el nom a ${name}`;
  }
  return "ha fet un canvi";
}

export interface ActivityGroup {
  key: string;
  entries: ActivityEntry[];
  user_id: string | null;
  at: string;
  area: ActivityArea;
  text: string;
  undone: boolean;
}

const PLURAL: Record<string, Partial<Record<ActivityEntry["action"], (n: number) => string>>> = {
  shopping_items: {
    insert: (n) => `ha afegit ${n} productes a la llista`,
    update: (n) => `ha canviat ${n} productes de la llista`,
    delete: (n) => `ha tret ${n} productes de la llista`,
  },
  pantry_items: {
    insert: (n) => `ha afegit ${n} productes al rebost`,
    update: (n) => `ha canviat ${n} productes del rebost`,
    delete: (n) => `ha tret ${n} productes del rebost`,
  },
  meal_plan: {
    insert: (n) => `ha afegit ${n} plats al menú`,
    update: (n) => `ha canviat ${n} plats del menú`,
    delete: (n) => `ha tret ${n} plats del menú`,
  },
  foods: { insert: (n) => `ha afegit ${n} aliments` },
};

/**
 * Ajunta les entrades d'una mateixa operació (la mateixa transacció, persona,
 * taula i acció), com buidar el carro o afegir els ingredients del menú.
 * Les entrades han d'arribar ordenades de més nova a més antiga.
 */
export function groupEntries(entries: ActivityEntry[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const e of entries) {
    const last = groups.at(-1);
    const head = last?.entries[0];
    if (
      last &&
      head &&
      head.tx === e.tx &&
      head.user_id === e.user_id &&
      head.table_name === e.table_name &&
      head.action === e.action &&
      !!head.undone_at === !!e.undone_at
    ) {
      last.entries.push(e);
      continue;
    }
    groups.push({ key: String(e.id), entries: [e], user_id: e.user_id, at: e.at, area: AREA_OF[e.table_name] ?? "llar", text: "", undone: !!e.undone_at });
  }
  for (const g of groups) {
    const n = g.entries.length;
    const head = g.entries[0];
    const plural = n > 1 ? PLURAL[head.table_name]?.[head.action] : undefined;
    g.text = plural ? plural(n) : n > 1 ? `${describeEntry(head)} i ${n - 1} més` : describeEntry(head);
  }
  return groups;
}

/** Es pot desfer? (la base de dades ho torna a comprovar) */
export function canUndoGroup(g: ActivityGroup, p: Permissions): boolean {
  if (g.undone) return false;
  return g.entries.every((e) => UNDOABLE.has(e.table_name) && (p.privileged || e.user_id === p.userId));
}

/** Nom de la persona per al registre */
export function whoName(
  userId: string | null,
  members: { user_id: string; display_name: string | null }[],
  me: { id: string; email?: string | null },
): string {
  if (!userId) return "Algú";
  const name = members.find((m) => m.user_id === userId)?.display_name?.trim();
  if (name) return name;
  if (userId === me.id) return me.email?.split("@")[0] || "Algú de casa";
  return members.some((m) => m.user_id === userId) ? "Algú de casa" : "Una persona que ja no és a casa";
}
