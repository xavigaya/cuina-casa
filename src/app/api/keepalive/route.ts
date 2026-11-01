import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tasca diària (Vercel Cron, vegeu vercel.json): fa una consulta lleugera a
 * Supabase perquè els projectes gratuïts no es posin en pausa per inactivitat
 * quan la família passa uns dies sense obrir l'app. No llegeix cap dada privada.
 */
export async function GET(request: Request) {
  // Si hi ha CRON_SECRET a Vercel, només la pot cridar el mateix Vercel
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autoritzat" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "Falta la configuració de Supabase" }, { status: 500 });
  try {
    // Un aliment de la taula de referència (és pública per a tothom)
    const res = await fetch(`${url}/rest/v1/foods?select=id&household_id=is.null&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    return NextResponse.json({ ok: res.ok, status: res.status, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
