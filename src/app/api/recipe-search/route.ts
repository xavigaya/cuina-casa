import { NextResponse } from "next/server";
import { searchOnlineRecipes } from "@/lib/online-search";
import type { Imbalance } from "@/lib/harvard";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Busca receptes a webs de cuina i les valora segons el Plat de Harvard. */
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Cal iniciar sessió" }, { status: 401 });

  let body: { query?: string; imbalance?: Imbalance; exclude?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Petició no vàlida" }, { status: 400 });
  }
  return NextResponse.json(await searchOnlineRecipes(supabase, body));
}
