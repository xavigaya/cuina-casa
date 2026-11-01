import { supabaseBrowser } from "./supabase/client";

export const PHOTO_BUCKET = "fotos-receptes";
const MAX_SIDE = 1600;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Mida final mantenint la proporció i sense ampliar mai la foto. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export class PhotoError extends Error {}

/** Redueix i comprimeix la foto al navegador (WebP o, si no és possible, JPEG). */
export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new PhotoError("El fitxer no és una imatge.");
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError("La foto és massa gran (màxim 25 MB).");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError(
      /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
        ? "Aquest navegador no pot obrir fotos HEIC. Desa-la en JPEG o puja-la des del mòbil."
        : "No s'ha pogut obrir la imatge.",
    );
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoError("No s'ha pogut processar la imatge.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const toBlob = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob("image/webp", 0.82);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg", 0.85);
  if (!jpeg) throw new PhotoError("No s'ha pogut comprimir la imatge.");
  return jpeg;
}

/** Puja una foto a la carpeta de la llar i en torna l'adreça pública. */
export async function uploadRecipePhoto(householdId: string, file: File): Promise<string> {
  const blob = await compressImage(file);
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${householdId}/${crypto.randomUUID()}.${ext}`;
  const storage = supabaseBrowser().storage.from(PHOTO_BUCKET);
  const { error } = await storage.upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
  if (error) {
    if (/bucket not found/i.test(error.message)) {
      throw new PhotoError("Falta preparar el magatzem de fotos: cal executar la migració 0004 a Supabase.");
    }
    throw new PhotoError(`No s'ha pogut pujar la foto: ${error.message}`);
  }
  return storage.getPublicUrl(path).data.publicUrl;
}

/**
 * Si l'adreça és d'una foto pujada a l'app i cap altra recepta no la fa servir
 * (les receptes duplicades comparteixen la foto), l'esborra del magatzem.
 */
export async function deleteUploadedPhoto(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return;
  const supabase = supabaseBrowser();
  const { data, error } = await supabase.from("recipes").select("id").eq("image_url", url).limit(1);
  if (error || (data && data.length > 0)) return; // encara la fa servir una altra recepta
  await supabase.storage.from(PHOTO_BUCKET).remove([decodeURIComponent(url.slice(i + marker.length))]);
}
