// TEMPORAL: prova de la cerca online amb casos fixos (s'esborrarà)
import { NextResponse } from "next/server";
import { extractRecipeFromHtml, parseLenientJson } from "@/lib/recipe-import";
import { SITES } from "@/lib/recipe-sites";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (compatible; CuinaCasa/1.0; +https://github.com/xavigaya/cuina-casa)";

export async function GET() {
  const tv3 = SITES.find((s) => s.id === "tv3")!;
  const listUrl = tv3.searchUrl("lentejas")!;
  const list = await fetch(listUrl, { headers: { "User-Agent": UA } }).then((r) => r.text()).catch(() => "");
  const links = tv3.extractLinks(list).slice(0, 2);
  const pages = await Promise.all(links.map(async (l) => {
    const html = await fetch(l, { headers: { "User-Agent": UA } }).then((r) => r.text()).catch(() => "");
    const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    const r = extractRecipeFromHtml(html, l);
    return {
      l,
      htmlLen: html.length,
      blocks: blocks.map((b) => {
        const parsed = parseLenientJson(b);
        const i = b.search(/recipeIngredient/i);
        return { len: b.length, parsed: parsed === undefined ? "NO" : "sí", snippet: i >= 0 ? JSON.stringify(b.slice(i, i + 260)) : null };
      }),
      title: r?.title ?? null,
      ingr: r?.ingredients.length ?? 0,
    };
  }));
  return NextResponse.json({ listUrl, listLen: list.length, linkCount: tv3.extractLinks(list).length, pages });
}
