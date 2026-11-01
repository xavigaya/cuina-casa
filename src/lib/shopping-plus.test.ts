import { describe, expect, it } from "vitest";
import {
  applyQueue,
  buildPriceIndex,
  enqueue,
  estimateCost,
  findPrice,
  fullSectionOrder,
  habitualSuggestions,
  moveSection,
  purchasesFromLog,
  sectionRank,
  summarizeCost,
  weekCost,
  type ProductPrice,
  type QueuedOp,
} from "./shopping-plus";
import { buildFoodIndex, type Food } from "./nutrition";
import { SECTIONS } from "./sections";
import type { RecipeNode } from "./shopping";
import type { ShoppingItem } from "./types";

describe("ordre per supermercat", () => {
  it("completa l'ordre amb les seccions que falten i ignora les desconegudes", () => {
    const order = fullSectionOrder(["congelats", "fruita", "inventada", "fruita"]);
    expect(order.slice(0, 2)).toEqual(["congelats", "fruita"]);
    expect(order).toHaveLength(SECTIONS.length);
    expect(sectionRank(["congelats"]).congelats).toBe(0);
  });
  it("puja i baixa seccions", () => {
    const order = moveSection([], "forn", -1);
    expect(order.indexOf("forn")).toBe(0);
    expect(moveSection(order, "forn", -1)).toEqual(order); // ja és la primera
  });
});

const price = (name: string, p: number, quantity: number, unit: string | null): ProductPrice => ({
  id: name,
  household_id: "h",
  name,
  key: name,
  price: p,
  quantity,
  unit,
  updated_at: "",
  updated_by: null,
});

describe("preus", () => {
  const prices = buildPriceIndex([price("llet", 1.2, 1, "l"), price("poma", 2.4, 1, "kg"), price("ou", 3, 12, "u"), price("ceba", 1.5, 1, "kg")]);
  const foods = buildFoodIndex([{ id: "ceba", household_id: null, name: "ceba", aliases: [], unit_g: 150, pack_g: null, density: 1 } as unknown as Food]);

  it("calcula el cost convertint unitats", () => {
    expect(estimateCost({ name: "Llet", quantity: 500, unit: "ml" }, prices, null)).toBeCloseTo(0.6);
    expect(estimateCost({ name: "ous", quantity: 6, unit: null }, prices, null)).toBeCloseTo(1.5);
    expect(estimateCost({ name: "ceba", quantity: 2, unit: null }, prices, foods)).toBeCloseTo(0.45); // 2 × 150 g
    expect(estimateCost({ name: "poma", quantity: null, unit: null }, prices, null)).toBe(2.4); // un paquet del preu
    expect(estimateCost({ name: "poma", quantity: 3, unit: null }, prices, null)).toBeNull(); // unitats sense pes
    expect(estimateCost({ name: "pa", quantity: 1, unit: null }, prices, null)).toBeNull();
  });
  it("troba el preu d'un producte més concret", () => {
    expect(findPrice(prices, "Llet sencera")?.key).toBe("llet");
    expect(findPrice(prices, "Pa")).toBeNull();
  });
  it("suma la llista i diu què no té preu", () => {
    const s = summarizeCost(
      [
        { name: "llet", quantity: 2, unit: "l" },
        { name: "pa", quantity: 1, unit: null },
      ],
      prices,
      null,
    );
    expect(s).toEqual({ total: 2.4, priced: 1, missing: ["pa"] });
  });
  it("calcula el cost del menú per ració", () => {
    const recipes = new Map<string, RecipeNode>([
      ["truita", { id: "truita", title: "Truita", servings: 4, yield_quantity: null, yield_unit: null, ingredients: [{ name: "ous", quantity: 6, unit: null }, { name: "sal", quantity: null, unit: null }] }],
    ]);
    const c = weekCost([{ recipeId: "truita", servings: 2 }, { recipeId: "esborrada", servings: 4 }], recipes, prices, null, 4);
    expect(c.total).toBeCloseTo(0.75);
    expect(c.portions).toBe(2);
    expect(c.missing).toEqual(["sal"]);
  });
});

describe("productes habituals", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86400000).toISOString();
  it("proposa el que es compra cada setmana i ja toca", () => {
    const purchases = [
      ...[7, 14, 21, 28].map((d) => ({ name: "llet", at: at(d) })),
      ...[1, 8, 15].map((d) => ({ name: "pa", at: at(d) })), // comprat ahir: encara no toca
      ...[10, 40].map((d) => ({ name: "safrà", at: at(d) })), // poques vegades
      ...[7, 14, 21].map((d) => ({ name: "Ous", at: at(d) })),
    ];
    const s = habitualSuggestions(purchases, [{ name: "ou" }], now);
    expect(s.map((x) => x.key)).toEqual(["llet"]); // els ous ja són a la llista
    expect(s[0]).toMatchObject({ name: "Llet", times: 4, everyDays: 7, sinceDays: 7 });
  });
  it("llegeix les compres del registre (marcar com a comprat)", () => {
    const p = purchasesFromLog([
      { label: "llet", at: "2026-10-01", action: "update", old_data: { checked: false }, new_data: { checked: true } },
      { label: "llet", at: "2026-10-02", action: "update", old_data: { checked: true }, new_data: { checked: false } },
      { label: "pa", at: "2026-10-03", action: "insert", old_data: null, new_data: { checked: false } },
    ]);
    expect(p).toEqual([{ name: "llet", at: "2026-10-01" }]);
  });
});

describe("llista sense cobertura", () => {
  const base: ShoppingItem = {
    id: "a",
    household_id: "h",
    name: "llet",
    quantity: null,
    unit: null,
    section: "lactics",
    note: null,
    checked: false,
    source: "manual",
    added_by: "u",
    created_at: "",
    checked_at: null,
  };
  it("ajunta els canvis d'un mateix producte", () => {
    let q: QueuedOp[] = [];
    const { id: _id, ...row } = { ...base, name: "pa" };
    q = enqueue(q, { kind: "insert", tempId: "pendent-1", row });
    q = enqueue(q, { kind: "update", id: "pendent-1", values: { checked: true } });
    q = enqueue(q, { kind: "update", id: "a", values: { checked: true } });
    q = enqueue(q, { kind: "update", id: "a", values: { checked: false } });
    expect(q).toHaveLength(2);
    expect(q[0]).toMatchObject({ kind: "insert", row: { name: "pa", checked: true } });
    expect(q[1]).toEqual({ kind: "update", id: "a", values: { checked: false } });
  });
  it("mostra la llista amb els canvis pendents aplicats", () => {
    const { id: _id, ...row } = { ...base, name: "pa" };
    const list = applyQueue([base], [
      { kind: "update", id: "a", values: { checked: true } },
      { kind: "insert", tempId: "pendent-1", row },
    ]);
    expect(list.map((i) => [i.id, i.name, i.checked])).toEqual([
      ["a", "llet", true],
      ["pendent-1", "pa", false],
    ]);
  });
});
