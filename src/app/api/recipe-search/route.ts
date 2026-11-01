import { NextResponse } from "next/server";
import { searchOnlineRecipes } from "@/lib/online-search";
import type { Imbalance } from "@/lib/harvard";
import { requireMember } from "@/lib/api-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Busca receptes a webs de cuina i les valora segons el Plat de Harvard. */
export async function POST(request: Request) {
  const access = await requireMember();
  if (access instanceof NextResponse) return access;
  const { supabase } = access;

  let body: { query?: string; imbalance?: Imbalance; exclude?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Petició no vàlida" }, { status: 400 });
  }
  return NextResponse.json(await searchOnlineRecipes(supabase, body));
}
