/**
 * Cerca de fotos amb llicència lliure, sense claus d'API:
 *  - Openverse (WordPress): milions de fotos Creative Commons (Flickr, etc.)
 *  - Wikimedia Commons
 */

export interface ImageResult {
  thumb: string;
  url: string;
  title: string;
  source: "Openverse" | "Wikimedia";
  page: string | null;
  license: string | null;
}

const USER_AGENT = "CuinaCasa/1.0 (https://github.com/xavigaya/cuina-casa)";

export function openverseUrl(query: string): string {
  const p = new URLSearchParams({ q: query, page_size: "20", mature: "false" });
  return `https://api.openverse.org/v1/images/?${p}`;
}

export function commonsUrl(query: string): string {
  const p = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "20",
    prop: "imageinfo",
    iiprop: "url|mime",
    iiurlwidth: "600",
  });
  return `https://commons.wikimedia.org/w/api.php?${p}`;
}

type Json = Record<string, unknown>;

export function parseOpenverse(json: unknown): ImageResult[] {
  const results = (json as Json)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((r: Json): ImageResult | null => {
      const url = typeof r.url === "string" ? r.url : null;
      if (!url) return null;
      const license = typeof r.license === "string" ? `CC ${r.license.toUpperCase()} ${r.license_version ?? ""}`.trim() : null;
      return {
        url,
        thumb: typeof r.thumbnail === "string" ? r.thumbnail : url,
        title: typeof r.title === "string" ? r.title : "",
        source: "Openverse",
        page: typeof r.foreign_landing_url === "string" ? r.foreign_landing_url : null,
        license: license === "CC CC0 1.0" ? "CC0" : license,
      };
    })
    .filter((x): x is ImageResult => x !== null);
}

export function parseCommons(json: unknown): ImageResult[] {
  const pages = ((json as Json)?.query as Json | undefined)?.pages;
  if (!pages || typeof pages !== "object") return [];
  return Object.values(pages as Record<string, Json>)
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((p): ImageResult | null => {
      const info = Array.isArray(p.imageinfo) ? (p.imageinfo[0] as Json) : null;
      if (!info || typeof info.url !== "string") return null;
      if (typeof info.mime === "string" && !/^image\/(jpeg|png|webp)$/.test(info.mime)) return null;
      return {
        url: typeof info.thumburl === "string" ? info.thumburl : info.url, // la miniatura de 600 px pesa molt menys
        thumb: typeof info.thumburl === "string" ? info.thumburl : info.url,
        title: typeof p.title === "string" ? p.title.replace(/^File:|^Fitxer:/, "").replace(/\.[a-z]+$/i, "") : "",
        source: "Wikimedia",
        page: typeof info.descriptionurl === "string" ? info.descriptionurl : null,
        license: null,
      };
    })
    .filter((x): x is ImageResult => x !== null);
}

/** Intercala els resultats de les dues fonts i treu duplicats. */
export function mergeResults(a: ImageResult[], b: ImageResult[]): ImageResult[] {
  const out: ImageResult[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const r of [a[i], b[i]]) {
      if (r && !seen.has(r.url)) {
        seen.add(r.url);
        out.push(r);
      }
    }
  }
  return out;
}

export async function searchImages(query: string): Promise<ImageResult[]> {
  const get = async (url: string) => {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  const [ov, wc] = await Promise.all([get(openverseUrl(query)), get(commonsUrl(query))]);
  return mergeResults(parseOpenverse(ov), parseCommons(wc));
}
