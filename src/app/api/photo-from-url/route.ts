import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { PHOTO_BUCKET } from "@/lib/photo-upload-constants";
import { publicHttpUrl } from "@/lib/safe-url";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Descarrega una foto d'un enllaç, la redueix (1600 px, WebP) i la desa al magatzem
 * de la llar. Així la foto no depèn de la web original (que la pot esborrar o
 * no deixar mostrar-la des d'altres llocs).
 */
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Cal iniciar sessió" }, { status: 401 });

  let householdId: string;
  let url: URL | null;
  try {
    const body = await request.json();
    householdId = String(body.householdId ?? "");
    url = publicHttpUrl(String(body.url ?? ""));
  } catch {
    return NextResponse.json({ error: "Petició no vàlida" }, { status: 400 });
  }
  if (!url || !/^[0-9a-f-]{36}$/i.test(householdId)) {
    return NextResponse.json({ error: "L'enllaç no és vàlid" }, { status: 400 });
  }

  // 1. Descàrrega (amb la pròpia web com a origen, perquè algunes ho exigeixen)
  let input: Buffer;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CuinaCasa/1.0; +https://github.com/xavigaya/cuina-casa)",
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        Referer: `${url.origin}/`,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return NextResponse.json({ error: "descarrega", detail: `La web ha respost amb un error (${res.status})` }, { status: 502 });
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/html")) {
      return NextResponse.json({ error: "no_imatge", detail: "L'enllaç és d'una pàgina web, no d'una imatge. Obre la imatge sola i copia'n l'adreça." }, { status: 422 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "massa_gran", detail: "La imatge és massa gran." }, { status: 413 });
    input = buf;
  } catch {
    return NextResponse.json({ error: "descarrega", detail: "No s'ha pogut descarregar la imatge." }, { status: 502 });
  }

  // 2. Reducció i conversió
  let output: Buffer;
  try {
    output = await sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "no_imatge", detail: "L'enllaç no és d'una imatge que es pugui obrir." }, { status: 422 });
  }

  // 3. Desar al magatzem de la llar (els permisos comproven que en siguis membre)
  const path = `${householdId}/${randomUUID()}.webp`;
  const storage = supabase.storage.from(PHOTO_BUCKET);
  const { error } = await storage.upload(path, output, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
  if (error) {
    const missing = /bucket not found/i.test(error.message);
    return NextResponse.json({ error: missing ? "falta_migracio" : "magatzem", detail: error.message }, { status: missing ? 503 : 500 });
  }
  return NextResponse.json({ url: storage.getPublicUrl(path).data.publicUrl });
}
