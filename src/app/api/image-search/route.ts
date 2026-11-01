import { NextResponse } from "next/server";
import { searchImages } from "@/lib/image-search";
import { requireMember } from "@/lib/api-auth";

export const runtime = "nodejs";

/** Busca fotos de plats a Openverse i Wikimedia Commons. */
export async function GET(request: Request) {
  const access = await requireMember();
  if (access instanceof NextResponse) return access;
  const { supabase } = access;

  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100);
  if (!q) return NextResponse.json({ results: [] });

  const results = await searchImages(q);
  return NextResponse.json({ results }, { headers: { "Cache-Control": "private, max-age=3600" } });
}
