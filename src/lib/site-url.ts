/**
 * Adreça pública de l'app, per compartir-la.
 * A Vercel s'usa el domini de producció (p. ex. cuina-casa.vercel.app), encara que
 * s'hagi obert l'app des d'una adreça de desplegament privada, que demanaria
 * iniciar sessió a Vercel a qui no en sigui membre.
 */
export function publicSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const production = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  return typeof window !== "undefined" ? window.location.origin : "";
}
