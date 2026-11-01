export type Course = "entrant" | "primer" | "segon" | "plat_unic" | "postres";

export const COURSES: { id: Course; label: string; plural: string; emoji: string }[] = [
  { id: "entrant", label: "Entrant", plural: "Entrants", emoji: "🥗" },
  { id: "primer", label: "Primer", plural: "Primers", emoji: "🍲" },
  { id: "segon", label: "Segon", plural: "Segons", emoji: "🍗" },
  { id: "plat_unic", label: "Plat únic", plural: "Plats únics", emoji: "🥘" },
  { id: "postres", label: "Postres", plural: "Postres", emoji: "🍰" },
];

/** Ordre en què se serveixen els plats en un àpat. */
export const COURSE_ORDER: Record<string, number> = Object.fromEntries(COURSES.map((c, i) => [c.id, i]));

export function courseInfo(id: string | null | undefined) {
  return COURSES.find((c) => c.id === id) ?? null;
}

/** Tipus de plat a partir de la categoria que dona la web («Primer Plat», «Postres», «Segundo»…). */
export function courseFromCategory(category: string | null | undefined): Course | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (/postre|dolç|dulce|dessert|pastís|pastel|tarta/.test(c)) return "postres";
  if (/plat únic|plato único|plat unic|plato unico/.test(c)) return "plat_unic";
  if (/segon|segundo|principal|main/.test(c)) return "segon";
  if (/primer|primero/.test(c)) return "primer";
  if (/entrant|entrante|aperitiu|aperitivo|tapa|starter/.test(c)) return "entrant";
  return null;
}
