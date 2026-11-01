/** Adreça pública de l'app si no se'n configura cap altra. */
const DEFAULT_PUBLIC_URL = "https://cuina-casa.vercel.app";

/**
 * Adreça pública de l'app, per compartir-la i instal·lar-la.
 * A Vercel s'usa el domini de producció (p. ex. cuina-casa.vercel.app), encara que
 * s'hagi obert l'app des d'una adreça de desplegament privada, que demanaria
 * iniciar sessió a Vercel a qui no en sigui membre.
 */
export function publicSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const production = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  if (typeof window !== "undefined" && isPrivateVercelHost(window.location.hostname)) return DEFAULT_PUBLIC_URL;
  return typeof window !== "undefined" ? window.location.origin : DEFAULT_PUBLIC_URL;
}

/** Adreces de desplegament de Vercel (privades): «…-git-main-…vercel.app», «…-xxxx-projects.vercel.app». */
export function isPrivateVercelHost(hostname: string): boolean {
  return /\.vercel\.app$/.test(hostname) && (/-projects\.vercel\.app$/.test(hostname) || /-git-/.test(hostname) || /-[a-z0-9]{9}-/.test(hostname));
}

/** L'app s'està fent servir des d'una adreça que no és la pública? */
export function onNonPublicHost(): boolean {
  if (typeof window === "undefined") return false;
  const pub = publicSiteUrl();
  return window.location.origin !== pub && /\.vercel\.app$/.test(window.location.hostname);
}
