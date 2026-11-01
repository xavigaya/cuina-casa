import { NextResponse } from "next/server";
import { extractRecipeFromHtml } from "@/lib/recipe-import";
import { translateRecipeToCatalan } from "@/lib/translate-server";
import { requireMember } from "@/lib/api-auth";
import { SafeFetchError, safeFetch } from "@/lib/safe-fetch";

export const runtime = "nodejs";

const MAX_BYTES = 3_000_000;

/** Descarrega una pàgina de receptes i n'extreu títol, ingredients i passos. */
export async function POST(request: Request) {
  const access = await requireMember();
  if (access instanceof NextResponse) return access;
  const { supabase } = access;

  let raw: string;
  try {
    const body = await request.json();
    raw = String(body.url ?? "").trim();
  } catch {
    return NextResponse.json({ error: "L'enllaç no és vàlid" }, { status: 400 });
  }

  let html: string;
  let url: URL;
  try {
    // safeFetch comprova que l'enllaç (i cada redirecció) no apunti a la xarxa interna
    const res = await safeFetch(raw, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CuinaCasa/1.0; +https://github.com/xavigaya/cuina-casa)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ca,es;q=0.8,en;q=0.5",
      },
      maxBytes: MAX_BYTES,
    });
    if (!res.ok) {
      return NextResponse.json({ error: `La web ha respost amb un error (${res.status})` }, { status: 502 });
    }
    html = res.text();
    url = new URL(res.url);
  } catch (e) {
    if (e instanceof SafeFetchError && e.reason === "adreça") return NextResponse.json({ error: "L'enllaç no és vàlid" }, { status: 400 });
    if (e instanceof SafeFetchError && e.reason === "mida") return NextResponse.json({ error: "La pàgina és massa gran" }, { status: 413 });
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
