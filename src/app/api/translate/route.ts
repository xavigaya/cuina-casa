import { NextResponse } from "next/server";
import { translateLines } from "@/lib/translate-server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Tradueix línies de text del castellà al català (Apertium). */
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Cal iniciar sessió" }, { status: 401 });

  let lines: string[];
  try {
    const body = await request.json();
    lines = Array.isArray(body.lines) ? body.lines.map((l: unknown) => String(l ?? "").slice(0, 2000)).slice(0, 300) : [];
  } catch {
    return NextResponse.json({ error: "Petició no vàlida" }, { status: 400 });
  }
  if (!lines.length) return NextResponse.json({ lines: [] });
  const translated = await translateLines(lines);
  if (!translated) return NextResponse.json({ error: "El traductor no respon ara mateix. Torna-ho a provar d'aquí a una estona." }, { status: 502 });
  return NextResponse.json({ lines: translated });
}
