import { describe, expect, it } from "vitest";
import { conflictSummary, findConflicts, ingredientMatches, parseList, recipeIngredientNames } from "./diet";
import { buildPushMessage, parsePushEvent } from "./push-messages";

describe("al·lèrgies i preferències", () => {
  it("reconeix els al·lèrgens pels noms dels ingredients", () => {
    expect(ingredientMatches("farina de blat", "gluten")).toBe(true);
    expect(ingredientMatches("Pa ratllat", "gluten")).toBe(true);
    expect(ingredientMatches("farina de blat de moro", "gluten")).toBe(false);
    expect(ingredientMatches("llet sencera", "llet")).toBe(true);
    expect(ingredientMatches("llet de coco", "llet")).toBe(false);
    expect(ingredientMatches("formatge ratllat", "llet")).toBe(true);
    expect(ingredientMatches("2 ous", "ous")).toBe(true);
    expect(ingredientMatches("brou de pollastre", "ous")).toBe(false);
    expect(ingredientMatches("nou moscada", "fruits_secs")).toBe(false);
    expect(ingredientMatches("nous pelades", "fruits_secs")).toBe(true);
    expect(ingredientMatches("gambes pelades", "crustacis")).toBe(true);
    expect(ingredientMatches("pebrot vermell", "gluten")).toBe(false);
  });
  it("compara els ingredients que algú no menja (plurals i variants)", () => {
    expect(ingredientMatches("cebes", "ceba")).toBe(true);
    expect(ingredientMatches("ceba tendra", "ceba")).toBe(true);
    expect(ingredientMatches("cebollí", "ceba")).toBe(false);
    expect(ingredientMatches("coriandre fresc", "coriandre")).toBe(true);
  });
  it("troba els conflictes de cada persona, primer les al·lèrgies, i mira dins dels preelaborats", () => {
    const recipes = new Map([
      ["lasanya", { ingredients: [{ name: "plaques de lasanya" }, { name: "beixamel", sub_recipe_id: "beixamel" }, { name: "ceba" }] }],
      ["beixamel", { ingredients: [{ name: "llet" }, { name: "farina" }, { name: "mantega" }] }],
    ]);
    const names = recipeIngredientNames("lasanya", recipes);
    expect(names).toContain("mantega");
    const c = findConflicts(names, [
      { user_id: "a", display_name: "Anna", allergies: ["llet"], avoid: ["ceba"] },
      { user_id: "p", display_name: "Pau", allergies: [], avoid: ["bolets"] },
    ]);
    expect(c.map((x) => [x.person, x.kind, x.item])).toEqual([
      ["Anna", "allergia", "llet"],
      ["Anna", "no_menja", "ceba"],
    ]);
    expect(c[0].ingredients).toEqual(["beixamel", "llet", "mantega"]);
    expect(conflictSummary(c)).toBe("Anna: al·lèrgia a llet i làctics (beixamel, llet, mantega) · Anna no menja ceba");
  });
  it("llegeix les llistes escrites a mà", () => {
    expect(parseList("Ceba, pebrot; coriandre\nceba")).toEqual(["ceba", "pebrot", "coriandre"]);
  });
});

describe("avisos al mòbil", () => {
  const uid = "11111111-1111-1111-1111-111111111111";
  it("valida el que arriba i no deixa enviar text lliure", () => {
    expect(parsePushEvent({ type: "llista", items: [] })).toBeNull();
    expect(parsePushEvent({ type: "altre", text: "hola" })).toBeNull();
    expect(parsePushEvent({ type: "resposta", label: "x", to: "no-és-un-id" })).toBeNull();
    expect(parsePushEvent({ type: "llista", items: ["llet\n\nurgent", "x".repeat(200)] })).toEqual({ type: "llista", items: ["llet urgent", "x".repeat(40)] });
  });
  it("compon els missatges en català", () => {
    expect(buildPushMessage({ type: "llista", items: ["llet", "pa", "ous"] }, "Anna")).toMatchObject({ kind: "llista", body: "Anna hi ha afegit llet, pa i ous", url: "/llista" });
    expect(buildPushMessage({ type: "llista", items: ["a", "b", "c", "d", "e", "f"] }, "Anna").body).toBe("Anna hi ha afegit a, b, c, d i 2 més");
    expect(buildPushMessage({ type: "proposta", what: "recepta", label: "Truita" }, "Pau")).toMatchObject({ kind: "propostes", body: "Pau proposa la recepta «Truita»" });
    expect(buildPushMessage({ type: "proposta", what: "menu", label: "x", count: 3 }, "Pau").body).toBe("Pau proposa 3 plats per al menú");
    expect(buildPushMessage({ type: "resposta", what: "menu", approved: true, label: "Sopa", to: uid }, "Xavi")).toMatchObject({
      kind: "respostes",
      to: uid,
      body: "Xavi ha aprovat la teva proposta «Sopa»",
    });
  });
});
