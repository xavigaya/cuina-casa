import type { Member, Role } from "./types";

/**
 * Permisos de cada llar. La base de dades els fa complir (RLS i disparadors,
 * migració 0005); aquí només serveixen per mostrar o amagar botons.
 *
 * - Privilegiat (role "owner"): ho pot fer tot.
 * - Col·laborador (role "member"): proposa receptes i àpats, afegeix a la
 *   llista, marca el que s'ha comprat, gestiona el rebost i edita o esborra
 *   només el que ha afegit ell.
 */
export interface Permissions {
  userId: string;
  privileged: boolean;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Privilegiat",
  member: "Col·laborador",
};

export const ROLE_HELP: Record<Role, string> = {
  owner: "Ho pot fer tot: aprovar propostes, editar i esborrar qualsevol cosa, canviar els ajustos i els permisos.",
  member: "Proposa receptes i àpats, afegeix a la llista, marca el que ha comprat i porta el rebost. Només edita el que ha afegit ell.",
};

export function permissionsFor(members: Pick<Member, "user_id" | "role">[], userId: string): Permissions {
  const me = members.find((m) => m.user_id === userId);
  return { userId, privileged: me?.role === "owner" };
}

type Owned = { created_by?: string | null };

/** Editar o esborrar una recepta o un àpat del menú */
export function canModify(p: Permissions, row: Owned): boolean {
  return p.privileged || (!!row.created_by && row.created_by === p.userId);
}

export function isProposal(row: { status?: string | null }): boolean {
  return row.status === "proposta";
}

/** Canviar el nom, la quantitat o la secció d'un producte de la llista */
export function canEditShoppingItem(p: Permissions, item: { added_by: string | null }): boolean {
  return p.privileged || item.added_by === p.userId;
}

/** Treure un producte de la llista: els propis i els que ja s'han comprat */
export function canDeleteShoppingItem(p: Permissions, item: { added_by: string | null; checked: boolean }): boolean {
  return p.privileged || item.added_by === p.userId || item.checked;
}

/** Es pot passar a "Privilegiat"/"Col·laborador" sense deixar la llar sense cap privilegiat? */
export function canChangeRole(members: Pick<Member, "user_id" | "role">[], target: string, next: Role): boolean {
  if (next === "owner") return true;
  return members.some((m) => m.role === "owner" && m.user_id !== target);
}
