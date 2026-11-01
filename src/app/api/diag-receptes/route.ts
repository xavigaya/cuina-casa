// TEMPORAL: diagnòstic de webs de receptes (s'esborrarà). Només consulta adreces fixes.
import { NextResponse } from "next/server";
import { extractRecipeFromHtml } from "@/lib/recipe-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  const pages = [
    "https://www.javirecetas.com/sopa-de-calabaza-clasica/",
    "https://www.lasrecetasdelaura.com/sopa-de-lentejas-estilo-jalisco-con-carne-receta-mexicana/",
    "https://www.3cat.cat/tv3/cuines/recepta/llenties-estofades/9141/",
  ];
  const out: unknown[] = [];
  for (const u of pages) {
    const p = await get(u);
    const blocks = [...p.text.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    const info = blocks.map((b) => {
      let err: string | null = null;
      try { JSON.parse(b.trim()); } catch (e) { err = (e as Error).message; }
      const i = b.indexOf("Recipe");
      return { len: b.length, err, start: b.trim().slice(0, 300), aroundRecipe: i >= 0 ? b.slice(Math.max(0, i - 200), i + 900) : null };
    });
    out.push({ url: u, status: p.status, blocks: info, ingredientHtml: (p.text.match(/.{0,200}(ingredient|Ingredient).{0,400}/) ?? [""])[0].slice(0, 700) });
  }
  const tv = await get("https://www.3cat.cat/tv3/cuines/llentia/receptes/");
  const rg = await get("https://www.recetasgratis.net/busqueda/q/lentejas");
  out.push({
    tv3: { status: tv.status, hrefs: [...new Set((tv.text.match(/href="[^"]*recepta[^"]*"/g) ?? []))].slice(0, 5) },
    recetasgratis: { status: rg.status, url: rg.url, hrefs: [...new Set((rg.text.match(/href="[^"]*receta[^"]*"/g) ?? []))].slice(0, 8) },
  });
  return NextResponse.json(out);
}
