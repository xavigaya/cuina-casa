// TEMPORAL: prova de la traducció (s'esborrarà)
import { NextResponse } from "next/server";
import { extractRecipeFromHtml } from "@/lib/recipe-import";
import { translateRecipeToCatalan } from "@/lib/translate-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const t0 = Date.now();
  const html = await fetch("https://www.pequerecetas.com/receta/crema-de-calabaza-y-naranja/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CuinaCasa/1.0; +https://github.com/xavigaya/cuina-casa)" },
  }).then((r) => r.text());
  const r = extractRecipeFromHtml(html, "https://www.pequerecetas.com/receta/crema-de-calabaza-y-naranja/")!;
  const { recipe, translated } = await translateRecipeToCatalan(r);
  return NextResponse.json({
    ms: Date.now() - t0,
    translated,
    title: [r.title, recipe.title],
    ingredients: recipe.ingredients.slice(0, 8).map((i, k) => `${r.ingredients[k].name} → ${i.name}`),
    steps: recipe.instructions.split("\n").slice(0, 3),
  });
}
