import { describe, expect, it } from "vitest";
import { parseIngredientLine, ingredientKey } from "./ingredients";
import { guessSection } from "./sections";
import { computeShoppingNeeds } from "./shopping";
import { parseLeadingNumber } from "./units";
import { extractRecipeFromHtml, parseDuration } from "./recipe-import";
import { expiryStatus, startOfWeek, toISODate } from "./dates";

describe("quantitats", () => {
  it("llegeix números i fraccions", () => {
    expect(parseLeadingNumber("2 cebes").value).toBe(2);
    expect(parseLeadingNumber("0,5 l de llet").value).toBe(0.5);
    expect(parseLeadingNumber("1/2 llimona").value).toBe(0.5);
    expect(parseLeadingNumber("1 1/2 tassa").value).toBe(1.5);
    expect(parseLeadingNumber("½ ceba").value).toBe(0.5);
    expect(parseLeadingNumber("2-3 grans d'all").value).toBe(3);
    expect(parseLeadingNumber("sal").value).toBeNull();
  });
});

describe("ingredients", () => {
  it("interpreta línies típiques", () => {
    expect(parseIngredientLine("200 g de farina")).toMatchObject({ quantity: 200, unit: "g", name: "farina", section: "rebost" });
    expect(parseIngredientLine("200g farina")).toMatchObject({ quantity: 200, unit: "g", name: "farina" });
    expect(parseIngredientLine("2 cebes")).toMatchObject({ quantity: 2, unit: "u", name: "cebes", section: "fruita" });
    expect(parseIngredientLine("1 cullerada d'oli d'oliva")).toMatchObject({ quantity: 1, unit: "cullerada", name: "oli d'oliva" });
    expect(parseIngredientLine("3 dientes de ajo")).toMatchObject({ quantity: 3, unit: "gra", name: "ajo" });
    expect(parseIngredientLine("Sal (opcional)")).toMatchObject({ quantity: null, unit: null, name: "sal", optional: true });
    expect(parseIngredientLine("   ")).toBeNull();
  });

  it("compara ingredients en singular i plural", () => {
    expect(ingredientKey("Cebes")).toBe(ingredientKey("ceba"));
    expect(ingredientKey("tomàquets")).toBe(ingredientKey("tomàquet"));
    expect(ingredientKey("patates")).toBe(ingredientKey("Patata"));
  });
});

describe("seccions", () => {
  it("endevina seccions del súper", () => {
    expect(guessSection("Llet sencera")).toBe("lactics");
    expect(guessSection("pit de pollastre")).toBe("carn");
    expect(guessSection("tomàquet triturat")).toBe("conserves");
    expect(guessSection("salmó")).toBe("peix");
    expect(guessSection("sal")).toBe("especies");
    expect(guessSection("cosa estranya")).toBe("altres");
  });
});

describe("llista des del menú", () => {
  const macarrons = {
    title: "Macarrons",
    servings: 4,
    ingredients: [
      { name: "macarrons", quantity: 400, unit: "g" },
      { name: "tomàquet triturat", quantity: 1, unit: "llauna" },
      { name: "ceba", quantity: 1, unit: "u" },
      { name: "sal", quantity: null, unit: null },
      { name: "formatge ratllat", quantity: 50, unit: "g", optional: true },
    ],
  };
  const truita = {
    title: "Truita",
    servings: 2,
    ingredients: [
      { name: "ous", quantity: 4, unit: "u" },
      { name: "cebes", quantity: 1, unit: "u" },
      { name: "patates", quantity: 0.5, unit: "kg" },
    ],
  };

  it("suma, escala i resta el rebost", () => {
    const result = computeShoppingNeeds(
      [
        { servings: null, recipe: macarrons },
        { servings: 4, recipe: truita },
      ],
      [
        { name: "Macarrons", quantity: 0.25, unit: "kg" },
        { name: "sal", quantity: null, unit: null },
        { name: "patata", quantity: 2, unit: "u" },
      ],
      [{ name: "ous", quantity: 6, unit: "u" }],
      4,
    );
    const byName = Object.fromEntries(result.map((r) => [r.name, r]));
    expect(byName["macarrons"]).toMatchObject({ quantity: 150, unit: "g" });
    expect(byName["ceba"]).toMatchObject({ quantity: 3, unit: "u" }); // 1 + 1×2
    expect(byName["patates"]).toMatchObject({ quantity: 1, unit: "kg" });
    expect(byName["patates"].note).toContain("a casa: 2");
    expect(byName["sal"]).toBeUndefined();
    expect(byName["ous"]).toMatchObject({ quantity: 2, unit: "u" }); // 8 - 6
    expect(byName["formatge ratllat"]).toBeUndefined();
    expect(byName["tomàquet triturat"]).toMatchObject({ quantity: 1, unit: "llauna" });
  });
});

describe("importació de receptes", () => {
  it("llegeix JSON-LD amb @graph", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "x" },
        {
          "@type": ["Recipe"],
          name: "Escalivada &amp; anxoves",
          recipeYield: ["4", "4 racions"],
          totalTime: "PT1H15M",
          image: [{ url: "https://exemple.cat/foto.jpg" }],
          recipeIngredient: ["2 albergínies", "3 pebrots vermells", "1 ceba", "Oli d'oliva"],
          recipeInstructions: [
            { "@type": "HowToStep", text: "Escalivar les verdures." },
            { "@type": "HowToStep", text: "Pelar i servir." },
          ],
        },
      ],
    })}</script></head></html>`;
    const r = extractRecipeFromHtml(html, "https://exemple.cat/r")!;
    expect(r.title).toBe("Escalivada & anxoves");
    expect(r.servings).toBe(4);
    expect(r.prepMinutes).toBe(75);
    expect(r.imageUrl).toBe("https://exemple.cat/foto.jpg");
    expect(r.ingredients).toHaveLength(4);
    expect(r.ingredients[1]).toMatchObject({ quantity: 3, name: "pebrots vermells" });
    expect(r.instructions).toBe("Escalivar les verdures.\nPelar i servir.");
  });

  it("durades ISO", () => {
    expect(parseDuration("PT45M")).toBe(45);
    expect(parseDuration("PT2H")).toBe(120);
  });
});

describe("dates", () => {
  it("setmana i caducitats", () => {
    expect(toISODate(startOfWeek(new Date(2026, 9, 30)))).toBe("2026-10-26");
    const today = new Date(2026, 9, 30);
    expect(expiryStatus("2026-10-29", 3, today)).toBe("caducat");
    expect(expiryStatus("2026-10-30", 3, today)).toBe("avui");
    expect(expiryStatus("2026-11-02", 3, today)).toBe("aviat");
    expect(expiryStatus("2026-11-10", 3, today)).toBe("ok");
  });
});
