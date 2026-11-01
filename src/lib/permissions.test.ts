import { describe, expect, it } from "vitest";
import { canChangeRole, canDeleteShoppingItem, canEditShoppingItem, canModify, isProposal, permissionsFor } from "./permissions";
import { canUndoGroup, describeEntry, groupEntries, whoName, type ActivityEntry } from "./activity";

const members = [
  { user_id: "p", role: "owner" as const, display_name: "Xavi" },
  { user_id: "c", role: "member" as const, display_name: "Anna" },
];
const P = permissionsFor(members, "p");
const C = permissionsFor(members, "c");

describe("permisos", () => {
  it("el creador és privilegiat i la resta col·laboradors", () => {
    expect(P.privileged).toBe(true);
    expect(C.privileged).toBe(false);
    expect(permissionsFor(members, "desconegut").privileged).toBe(false);
  });

  it("un col·laborador només modifica el que ha afegit ell", () => {
    expect(canModify(C, { created_by: "c" })).toBe(true);
    expect(canModify(C, { created_by: "p" })).toBe(false);
    expect(canModify(C, { created_by: null })).toBe(false);
    expect(canModify(P, { created_by: "c" })).toBe(true);
  });

  it("a la llista, marca qualsevol cosa però només esborra la seva o la ja comprada", () => {
    const aliena = { added_by: "p", checked: false };
    expect(canEditShoppingItem(C, aliena)).toBe(false);
    expect(canDeleteShoppingItem(C, aliena)).toBe(false);
    expect(canDeleteShoppingItem(C, { ...aliena, checked: true })).toBe(true);
    expect(canDeleteShoppingItem(C, { added_by: "c", checked: false })).toBe(true);
    expect(canEditShoppingItem(P, aliena)).toBe(true);
  });

  it("la llar no es pot quedar sense cap privilegiat", () => {
    expect(canChangeRole(members, "p", "member")).toBe(false);
    expect(canChangeRole(members, "c", "owner")).toBe(true);
    expect(canChangeRole([...members, { user_id: "q", role: "owner" as const }], "p", "member")).toBe(true);
  });

  it("les propostes es reconeixen; sense la migració tot compta com a aprovat", () => {
    expect(isProposal({ status: "proposta" })).toBe(true);
    expect(isProposal({ status: "aprovada" })).toBe(false);
    expect(isProposal({})).toBe(false);
  });
});

let nextId = 100;
function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: nextId--,
    household_id: "h",
    user_id: "c",
    at: "2026-11-01T10:00:00Z",
    table_name: "shopping_items",
    row_id: "r" + nextId,
    action: "insert",
    label: "llet",
    old_data: null,
    new_data: null,
    tx: 1,
    undone_at: null,
    undone_by: null,
    ...over,
  };
}

describe("registre d'accions", () => {
  it("descriu les accions en català", () => {
    expect(describeEntry(entry({ action: "insert" }))).toBe("ha afegit «llet» a la llista");
    expect(describeEntry(entry({ action: "update", old_data: { checked: false }, new_data: { checked: true } }))).toBe("ha comprat «llet»");
    expect(describeEntry(entry({ table_name: "recipes", label: "Truita", new_data: { status: "proposta" } }))).toBe("ha proposat la recepta «Truita»");
    expect(
      describeEntry(entry({ table_name: "recipes", action: "update", label: "Truita", old_data: { row: { status: "proposta", title: "Truita" } }, new_data: { status: "aprovada", title: "Truita" } })),
    ).toBe("ha aprovat la recepta «Truita»");
    expect(
      describeEntry(entry({ table_name: "recipes", action: "delete", user_id: "p", label: "Pizza", old_data: { row: { status: "proposta", created_by: "c" } } })),
    ).toBe("ha rebutjat la proposta de recepta «Pizza»");
    expect(describeEntry(entry({ table_name: "recipes", action: "delete", label: "Pizza", old_data: { row: { status: "aprovada" } } }))).toBe(
      "ha esborrat la recepta «Pizza»",
    );
    expect(describeEntry(entry({ table_name: "pantry_items", label: "arròs", new_data: { location: "nevera" } }))).toBe("ha afegit «arròs» a la nevera");
    expect(describeEntry(entry({ table_name: "household_members", action: "update", label: "Anna", old_data: { role: "member" }, new_data: { role: "owner" } }))).toBe(
      "ha fet privilegiat «Anna»",
    );
    expect(describeEntry(entry({ table_name: "meal_plan", action: "delete", label: "Sopa", old_data: { meal: "sopar", day: "2026-11-02" } }))).toMatch(
      /^ha tret «Sopa» del sopar del .*2\/11$/,
    );
  });

  it("ajunta les accions d'una mateixa operació (buidar el carro)", () => {
    const list = [
      entry({ action: "delete", tx: 9, label: "a" }),
      entry({ action: "delete", tx: 9, label: "b" }),
      entry({ action: "delete", tx: 9, label: "c" }),
      entry({ action: "insert", tx: 8, label: "d" }),
      entry({ action: "delete", tx: 7, user_id: "p", label: "e" }),
    ];
    const groups = groupEntries(list);
    expect(groups.map((g) => g.entries.length)).toEqual([3, 1, 1]);
    expect(groups[0].text).toBe("ha tret 3 productes de la llista");
    expect(groups[1].text).toBe("ha afegit «d» a la llista");
  });

  it("cadascú desfà les seves accions i els privilegiats, qualsevol", () => {
    const [mine, theirs, member] = groupEntries([
      entry({ tx: 1, user_id: "c" }),
      entry({ tx: 2, user_id: "p" }),
      entry({ tx: 3, user_id: "p", table_name: "household_members", action: "update" }),
    ]);
    expect(canUndoGroup(mine, C)).toBe(true);
    expect(canUndoGroup(theirs, C)).toBe(false);
    expect(canUndoGroup(theirs, P)).toBe(true);
    expect(canUndoGroup(member, P)).toBe(false); // els canvis de permisos no es desfan des del registre
    const [undone] = groupEntries([entry({ undone_at: "2026-11-01T11:00:00Z" })]);
    expect(canUndoGroup(undone, P)).toBe(false);
  });

  it("posa nom a qui ha fet cada acció", () => {
    expect(whoName("c", members, { id: "p" })).toBe("Anna");
    expect(whoName("p", [{ user_id: "p", display_name: null }], { id: "p", email: "xavi@exemple.cat" })).toBe("xavi");
    expect(whoName("z", members, { id: "p" })).toBe("Una persona que ja no és a casa");
  });
});
