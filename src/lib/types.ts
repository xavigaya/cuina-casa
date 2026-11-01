import type { Course } from "./courses";

export interface Household {
  id: string;
  name: string;
  servings: number;
  invite_code: string;
  /** quan caduca el codi d'invitació (migració 0010) */
  invite_expires_at?: string | null;
  expiry_warning_days: number;
}

export interface Member {
  household_id: string;
  user_id: string;
  display_name: string | null;
  /** owner = privilegiat (ho pot fer tot) · member = col·laborador */
  role: Role;
  /** al·lèrgens o ingredients que no pot menjar (migració 0008) */
  allergies?: string[];
  /** ingredients que no menja o no li agraden */
  avoid?: string[];
}

export type Role = "owner" | "member";

/** Les receptes i els àpats que afegeix un col·laborador queden com a proposta */
export type ApprovalStatus = "aprovada" | "proposta";

export interface ShoppingItem {
  id: string;
  household_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  section: string;
  note: string | null;
  checked: boolean;
  source: "manual" | "menu" | "rebost";
  added_by: string | null;
  created_at: string;
  checked_at: string | null;
}

export type Location = "rebost" | "nevera" | "congelador";

export interface PantryItem {
  id: string;
  household_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  location: Location;
  section: string;
  expires_on: string | null;
  barcode: string | null;
  min_quantity: number | null;
  created_at: string;
  updated_at: string;
}

export interface Recipe {
  id: string;
  household_id: string;
  title: string;
  servings: number;
  prep_minutes: number | null;
  instructions: string | null;
  source_url: string | null;
  image_url: string | null;
  tags: string[];
  course: Course | null;
  is_component: boolean;
  yield_quantity: number | null;
  yield_unit: string | null;
  status: ApprovalStatus;
  created_by: string | null;
  created_at: string;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  position: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  section: string;
  optional: boolean;
  sub_recipe_id: string | null;
}

export type RecipeWithIngredients = Recipe & { recipe_ingredients: RecipeIngredient[] };

export type Meal = "esmorzar" | "dinar" | "sopar";

export interface MealPlanEntry {
  id: string;
  household_id: string;
  day: string;
  meal: Meal;
  recipe_id: string | null;
  note: string | null;
  servings: number | null;
  status: ApprovalStatus;
  created_by: string | null;
}

export interface Product {
  id: string;
  household_id: string;
  name: string;
  section: string;
  barcode: string | null;
  default_unit: string | null;
}

export const LOCATIONS: { id: Location; label: string; emoji: string }[] = [
  { id: "rebost", label: "Rebost", emoji: "🗄️" },
  { id: "nevera", label: "Nevera", emoji: "🧊" },
  { id: "congelador", label: "Congelador", emoji: "❄️" },
];

export const MEALS: { id: Meal; label: string }[] = [
  { id: "esmorzar", label: "Esmorzar" },
  { id: "dinar", label: "Dinar" },
  { id: "sopar", label: "Sopar" },
];
