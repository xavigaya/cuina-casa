import { NextResponse } from "next/server";
import { searchImages } from "@/lib/image-search";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Busca fotos de plats a Openverse i Wikimedia Commons. */
export async function GET(request: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Cal iniciar sessió" }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100);
  if (!q) return NextResponse.json({ results: [] });

  const results = await searchImages(q);
  return NextResponse.json({ results }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
