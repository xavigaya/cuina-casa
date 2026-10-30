/** Utilitats de dates en hora local (sense desfasaments d'UTC). */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Dilluns de la setmana d'una data. */
export function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (r.getDay() + 6) % 7; // dilluns = 0
  return addDays(r, -dow);
}

export function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function daysUntil(isoDate: string, today: Date = new Date()): number {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((fromISODate(isoDate).getTime() - t.getTime()) / 86_400_000);
}

export type ExpiryStatus = "caducat" | "avui" | "aviat" | "ok" | "sense";

export function expiryStatus(isoDate: string | null, warningDays: number, today?: Date): ExpiryStatus {
  if (!isoDate) return "sense";
  const n = daysUntil(isoDate, today);
  if (n < 0) return "caducat";
  if (n === 0) return "avui";
  if (n <= warningDays) return "aviat";
  return "ok";
}

export function expiryLabel(isoDate: string | null, today?: Date): string {
  if (!isoDate) return "";
  const n = daysUntil(isoDate, today);
  if (n < -1) return `Caducat fa ${-n} dies`;
  if (n === -1) return "Caducat ahir";
  if (n === 0) return "Caduca avui";
  if (n === 1) return "Caduca demà";
  if (n <= 14) return `Caduca d'aquí a ${n} dies`;
  return `Caduca el ${formatShortDate(isoDate)}`;
}

const DAY_NAMES = ["diumenge", "dilluns", "dimarts", "dimecres", "dijous", "divendres", "dissabte"];
const DAY_SHORT = ["dg", "dl", "dt", "dc", "dj", "dv", "ds"];
const MONTHS = ["gen.", "febr.", "març", "abr.", "maig", "juny", "jul.", "ag.", "set.", "oct.", "nov.", "des."];

export function dayName(d: Date): string {
  return DAY_NAMES[d.getDay()];
}

export function dayShort(d: Date): string {
  return DAY_SHORT[d.getDay()];
}

export function formatShortDate(iso: string): string {
  const d = fromISODate(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  const a = `${monday.getDate()} ${MONTHS[monday.getMonth()]}`;
  const b = `${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`;
  return `${a} – ${b}`;
}
