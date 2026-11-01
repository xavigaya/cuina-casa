// TEMPORAL: prova de descàrrega i reducció d'una foto concreta (s'esborrarà; no desa res)
import { NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = new URL("https://agora.xtec.cat/ceipalba/wp-content/uploads/usu598/2016/01/deisi-salmo-4.jpg");
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CuinaCasa/1.0; +https://github.com/xavigaya/cuina-casa)", Accept: "image/*", Referer: `${url.origin}/` },
      signal: AbortSignal.timeout(12000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = res.ok ? await sharp(buf).metadata() : null;
    const out = res.ok ? await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer() : null;
    return NextResponse.json({ status: res.status, type: res.headers.get("content-type"), bytes: buf.byteLength, width: meta?.width, height: meta?.height, webpBytes: out?.byteLength });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message });
  }
}
