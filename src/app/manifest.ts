import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cuina Casa",
    short_name: "Cuina",
    description: "Llista de la compra, rebost, receptes i menú setmanal de la família.",
    lang: "ca",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fbf7f0",
    theme_color: "#d24f2c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Llista de la compra", url: "/llista", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Rebost", url: "/rebost", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Menú", url: "/menu", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
