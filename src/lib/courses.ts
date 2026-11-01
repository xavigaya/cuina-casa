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
