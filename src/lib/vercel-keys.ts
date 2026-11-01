/**
 * Genera, al navegador, les claus que van a les variables d'entorn de Vercel.
 * No s'envien enlloc: només es mostren per copiar-les.
 */

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Parell de claus VAPID (P-256) en el format de web-push */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.d) throw new Error("No s'ha pogut generar la clau privada");
  return { publicKey: base64url(raw), privateKey: jwk.d };
}

/** Secret aleatori per a CRON_SECRET (256 bits) */
export function generateSecret(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}
