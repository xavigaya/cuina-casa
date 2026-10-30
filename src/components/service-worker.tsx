"use client";

import { useEffect } from "react";

/** Registra el service worker perquè l'app es pugui instal·lar i obrir sense connexió. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
