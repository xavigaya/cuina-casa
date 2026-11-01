// TEMPORAL: prova de la cerca de valors nutricionals (s'esborrarà)
import { NextResponse } from "next/server";
import { proposalFromProducts, searchOffProducts } from "@/lib/food-lookup";
import { translateLines } from "@/lib/translate-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const names = ["farina d'espelta", "llet de coco", "tofu fumat", "seitan", "pols màgica inventada"];
  const t0 = Date.now();
  const spanish = (await translateLines(names, "cat|spa")) ?? names;
  const out = await Promise.all(names.map(async (name, i) => {
    const queries = [...new Set([spanish[i], name].map((q) => q.toLowerCase()))];
    const results = await Promise.all(queries.map(searchOffProducts));
    const p = proposalFromProducts(name, queries, results.flat());
    return `${name} [${queries.join(" | ")}] trobats ${results.flat().length} → ${p ? `${p.kcal} kcal, HC ${p.carbs}, P ${p.protein}, G ${p.fat}, F ${p.fiber}, ${p.harvard_group}, n=${p.samples}, ex: ${p.examples.join(" / ")}` : "cap proposta"}`;
  }));
  return NextResponse.json({ ms: Date.now() - t0, out });
}
