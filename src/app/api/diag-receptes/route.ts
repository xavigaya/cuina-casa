// TEMPORAL: diagnòstic de webs de receptes (s'esborrarà). Només consulta adreces fixes.
import { NextResponse } from "next/server";
import { extractRecipeFromHtml } from "@/lib/recipe-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const SITES: { name: string; search: string; wp?: boolean; link?: RegExp }[] = [
  { name: "pequerecetas", search: "https://www.pequerecetas.com/wp-json/wp/v2/posts?search=lentejas&_fields=link,title&per_page=5", wp: true },
  { name: "javirecetas", search: "https://www.javirecetas.com/wp-json/wp/v2/posts?search=lentejas&_fields=link,title&per_page=5", wp: true },
  { name: "3cat-llistat", search: "https://www.3cat.cat/tv3/cuines/llentia/receptes/", link: /https:\/\/www\.3cat\.cat\/tv3\/cuines\/recepta\/[a-z0-9-]+\/\d+\//g },
  { name: "cookpad", search: "https://cookpad.com/es/buscar/lentejas", link: /\/es\/recetas\/\d+[a-z0-9-]*/g },
  { name: "recetasgratis", search: "https://www.recetasgratis.net/busqueda/q/lentejas", link: /https:\/\/www\.recetasgratis\.net\/receta-de-[a-z0-9-]+\.html/g },
  { name: "directoalpaladar", search: "https://www.directoalpaladar.com/buscar?q=lentejas", link: /https:\/\/www\.directoalpaladar\.com\/recetas-de-[a-z0-9-]+\/[a-z0-9-]+/g },
  { name: "hogarmania", search: "https://www.hogarmania.com/buscador.html?q=lentejas", link: /https:\/\/www\.hogarmania\.com\/cocina\/recetas\/[a-z0-9-/]+\.html/g },
  { name: "recetasderechupete-abc", search: "https://www.abc.es/recetasderechupete/?s=lentejas", link: /https:\/\/www\.abc\.es\/recetasderechupete\/[a-z0-9-]+\/\d+\//g },
  { name: "unareceta", search: "https://unareceta.com/?s=lentejas", link: /https:\/\/unareceta\.com\/[a-z0-9-]+\//g },
  { name: "cocinillas-wp", search: "https://www.cocinillas.es/wp-json/wp/v2/posts?search=lentejas&_fields=link,title&per_page=5", wp: true },
  { name: "lasrecetasdelaura-wp", search: "https://www.lasrecetasdelaura.com/wp-json/wp/v2/posts?search=lentejas&_fields=link,title&per_page=5", wp: true },
  { name: "velocidadcuchara-wp", search: "https://www.velocidadcuchara.com/wp-json/wp/v2/posts?search=lentejas&_fields=link,title&per_page=5", wp: true },
  { name: "cocinaconpoco-wp", search: "https://cocinaconpoco.com/wp-json/wp/v2/posts?search=lentejas&_fields=link,title&per_page=5", wp: true },
  { name: "recetasderuth-wp", search: "https://www.recetasderuth.com/wp-json/wp/v2/posts?search=lentejas&_fields=link,title&per_page=5", wp: true },
];

async function get(url: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/json", "Accept-Language": "ca,es;q=0.9" }, signal: AbortSignal.timeout(9000), redirect: "follow" });
    return { status: r.status, url: r.url, text: r.ok ? await r.text() : "" };
  } catch (e) {
    return { status: 0, url, text: "", error: (e as Error).message };
  }
}

export async function GET() {
  const out = await Promise.all(
    SITES.map(async (s) => {
      const res = await get(s.search);
      let links: string[] = [];
      if (s.wp) {
        try {
          links = (JSON.parse(res.text) as { link: string }[]).map((p) => p.link);
        } catch {}
      } else if (s.link) {
        const base = new URL(s.search).origin;
        links = [...new Set((res.text.match(s.link) ?? []).map((l) => (l.startsWith("http") ? l : base + l)))];
      }
      const pages = await Promise.all(
        links.slice(0, 2).map(async (l) => {
          const p = await get(l);
          const r = p.text ? extractRecipeFromHtml(p.text, l) : null;
          return {
            url: l,
            status: p.status,
            ldjson: /application\/ld\+json/i.test(p.text),
            ldRecipe: /"@type"\s*:\s*\[?\s*"Recipe"/i.test(p.text),
            microdata: /itemprop=["']recipeIngredient/i.test(p.text),
            title: r?.title ?? null,
            ingredients: r?.ingredients.length ?? 0,
            firstIngredients: r?.ingredients.slice(0, 3).map((i) => i.name) ?? [],
            image: !!r?.imageUrl,
            servings: r?.servings ?? null,
          };
        }),
      );
      return { site: s.name, status: res.status, error: (res as { error?: string }).error, linksFound: links.length, sample: links.slice(0, 3), pages };
    }),
  );
  return NextResponse.json(out);
}
