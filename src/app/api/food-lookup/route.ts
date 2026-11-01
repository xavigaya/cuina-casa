import { NextResponse } from "next/server";
import { proposalFromProducts, searchOffProducts, type FoodProposal } from "@/lib/food-lookup";
import { translateLines } from "@/lib/translate-server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Proposa valors nutricionals per a ingredients desconeguts (Open Food Facts). */
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Cal iniciar sessió" }, { status: 401 });

  let names: string[];
  try {
    const body = await request.json();
    names = Array.isArray(body.names) ? body.names.map((n: unknown) => String(n ?? "").trim().slice(0, 80)).filter(Boolean).slice(0, 10) : [];
  } catch {
    return NextResponse.json({ error: "Petició no vàlida" }, { status: 400 });
  }
  if (!names.length) return NextResponse.json({ proposals: [] });

  // Molts productes d'Open Food Facts a Espanya tenen el nom en castellà: es busca en totes dues llengües
  const spanish = (await translateLines(names, "cat|spa")) ?? names;
  const proposals: (FoodProposal | null)[] = await Promise.all(
    names.map(async (name, i) => {
      const queries = [...new Set([spanish[i], name].map((q) => q.toLowerCase()))];
      const results = await Promise.all(queries.map(searchOffProducts));
      return proposalFromProducts(name, queries, results.flat());
    }),
  );
  return NextResponse.json({ proposals });
}
