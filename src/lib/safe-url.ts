/** Adreces que no s'han de descarregar mai des del servidor (xarxa interna). */
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|.*\.local$|.*\.internal$)/i;

/** Torna l'adreça si és http(s) pública; si no, null. */
export function publicHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol) || PRIVATE_HOST.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}
