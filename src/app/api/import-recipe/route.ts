import { NextResponse } from "next/server";
import { extractRecipeFromHtml } from "@/lib/recipe-import";
import { translateRecipeToCatalan } from "@/lib/translate-server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_BYTES = 3_000_000;
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|.*\.local$|.*\.internal$)/i;

/** Descarrega una pàgina de receptes i n'extreu títol, ingredients i passos. */
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Cal iniciar sessió" }, { status: 401 });

  let url: URL;
  try {
    const body = await request.json();
    url = new URL(String(body.url ?? "").trim());
  } catch {
    return NextResponse.json({ error: "L'enllaç no és vàlid" }, { status: 400 });
  }
  if (!["http:", "https:"].includes(url.protocol) || PRIVATE_HOST.test(url.hostname)) {
    return NextResponse.json({ error: "L'enllaç no és vàlid" }, { status: 400 });
  }

  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CuinaCasa/1.0; +https://github.com/xavigaya/cuina-casa)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ca,es;q=0.8,en;q=0.5",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `La web ha respost amb un error (${res.status})` }, { status: 502 });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "La pàgina és massa gran" }, { status: 413 });
    html = new TextDecoder("utf-8").decode(buf);
  } catch {
    return NextResponse.json({ error: "No s'ha pogut obrir la pàgina" }, { status: 502 });
  }

  const recipe = extractRecipeFromHtml(html, url.toString());
  if (!recipe || recipe.ingredients.length === 0) {
    return NextResponse.json(
      { error: "No hem trobat cap recepta en aquesta pàgina. Pots copiar-ne els ingredients a mà." },
      { status: 422 },
    );
  }
  // Si és en castellà, es tradueix al català; es torna també l'original per poder-lo consultar
  const { recipe: catalan, translated } = await translateRecipeToCatalan(recipe);
  return NextResponse.json(translated ? { ...catalan, translated: true, original: recipe } : { ...recipe, translated: false });
}
