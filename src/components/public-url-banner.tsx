"use client";

import { useEffect, useState } from "react";
import { onNonPublicHost, publicSiteUrl } from "@/lib/site-url";

/**
 * Avís quan l'app s'obre des d'una adreça privada de Vercel: allà no es pot
 * instal·lar (Vercel no deixa llegir el manifest) i els convidats no hi poden entrar.
 */
export function PublicUrlBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => setShow(onNonPublicHost()), []);
  if (!show) return null;
  const url = publicSiteUrl();
  return (
    <div className="mx-4 mt-3 rounded-2xl border-2 border-saffron/60 bg-saffron-soft p-3 text-sm lg:mx-8">
      <p className="font-semibold">Estàs fent servir una adreça privada de Vercel</p>
      <p className="mt-0.5 text-xs text-muted">
        Des d'aquí l'app no es pot instal·lar al mòbil ni compartir. Obre-la des de l'adreça pública (hauràs de tornar a entrar amb Google).
      </p>
      <a href={url} className="mt-2 inline-block rounded-full bg-herb px-3 py-1.5 text-xs font-bold text-paper">
        Obre {url.replace(/^https?:\/\//, "")}
      </a>
    </div>
  );
}
