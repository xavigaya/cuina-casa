// TEMPORAL: prova de la cerca online amb casos fixos (s'esborrarà)
import { NextResponse } from "next/server";
import { searchOnlineRecipes } from "@/lib/online-search";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await supabaseServer();
  const t0 = Date.now();
  const a = await searchOnlineRecipes(supabase, { query: "lentejas" });
  const t1 = Date.now();
  const b = await searchOnlineRecipes(supabase, {
    imbalance: { needVeg: true, tooMuchGrain: true, refined: true, needProtein: false, tooMuchProtein: false, missingProteins: ["peix"], tooMuchRedMeat: false },
  });
  const t2 = Date.now();
  const summary = (r: Awaited<ReturnType<typeof searchOnlineRecipes>>) => ({
    queries: r.queries,
    results: r.results.map((x) => `${x.site} | ${x.title} | ingr ${x.recipe.ingredients.length} | img ${x.image ? "sí" : "no"} | kcal ${x.perServing?.kcal ?? "-"} | ${x.evaluation?.status ?? "-"} ${x.evaluation?.score ?? ""} | ${x.course ?? ""}`),
  });
  return NextResponse.json({ lentejas: { ms: t1 - t0, ...summary(a) }, desequilibri: { ms: t2 - t1, ...summary(b) } });
}
