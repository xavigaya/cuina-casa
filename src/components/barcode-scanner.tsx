"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { guessSection } from "@/lib/sections";
import { Sheet, Spinner } from "./ui";

export interface ScannedProduct {
  barcode: string;
  name: string;
  section: string;
  /** El producte ja era al catàleg de la llar o s'ha trobat a Open Food Facts */
  known: boolean;
}

/**
 * Busca un codi de barres: primer al catàleg de la llar (productes ja escanejats)
 * i després a Open Food Facts, la base de dades oberta d'aliments.
 */
export async function lookupBarcode(householdId: string, barcode: string): Promise<ScannedProduct> {
  const supabase = supabaseBrowser();
  const { data } = await supabase
    .from("products")
    .select("name, section")
    .eq("household_id", householdId)
    .eq("barcode", barcode)
    .maybeSingle();
  if (data) return { barcode, name: data.name, section: data.section, known: true };

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,product_name_ca,product_name_es,generic_name,brands,quantity`,
    );
    if (res.ok) {
      const json = await res.json();
      const p = json?.product;
      const base: string | undefined = p?.product_name_ca || p?.product_name_es || p?.product_name || p?.generic_name;
      if (base) {
        const brand = typeof p.brands === "string" ? p.brands.split(",")[0].trim() : "";
        const name = brand && !base.toLowerCase().includes(brand.toLowerCase()) ? `${base} ${brand}` : base;
        return { barcode, name: name.trim(), section: guessSection(base), known: true };
      }
    }
  } catch {
    // Sense connexió o servei no disponible: l'usuari escriurà el nom
  }
  return { barcode, name: "", section: "altres", known: false };
}

/** Desa al catàleg de la llar perquè la propera vegada es reconegui a l'instant. */
export async function rememberProduct(householdId: string, product: { barcode: string; name: string; section: string }) {
  await supabaseBrowser()
    .from("products")
    .upsert(
      { household_id: householdId, barcode: product.barcode, name: product.name, section: product.section },
      { onConflict: "household_id,barcode" },
    );
}

export function BarcodeScanner({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (barcode: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"iniciant" | "escanejant" | "error">("iniciant");
  const [errorText, setErrorText] = useState("");
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);
  const detectedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    detectedRef.current = false;
    setStatus("iniciant");
    setShowManual(false);
    let stop: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          videoRef.current,
          (result) => {
            if (result && !detectedRef.current) {
              detectedRef.current = true;
              if (navigator.vibrate) navigator.vibrate(60);
              controls.stop();
              onDetected(result.getText());
            }
          },
        );
        stop = () => controls.stop();
        if (cancelled) stop();
        else setStatus("escanejant");
      } catch (e) {
        setStatus("error");
        const name = (e as Error)?.name;
        setErrorText(
          name === "NotAllowedError"
            ? "Cal donar permís per fer servir la càmera."
            : name === "NotFoundError"
              ? "No s'ha trobat cap càmera en aquest dispositiu."
              : "No s'ha pogut obrir la càmera.",
        );
        setShowManual(true);
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [open, onDetected]);

  return (
    <Sheet open={open} onClose={onClose} title="Escaneja el codi de barres">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        {status === "escanejant" && (
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        )}
        {status === "iniciant" && (
          <div className="absolute inset-0 grid place-items-center">
            <Spinner />
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white">{errorText}</div>
        )}
      </div>
      <p className="mt-3 text-center text-sm text-muted">Apunta al codi de barres del producte.</p>

      {showManual ? (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onDetected(manual.trim());
          }}
        >
          <input
            className="input font-mono"
            inputMode="numeric"
            placeholder="Escriu el número del codi"
            value={manual}
            onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
          <button className="btn-primary" disabled={!manual}>
            Busca
          </button>
        </form>
      ) : (
        <button className="btn-ghost mx-auto mt-2 flex" onClick={() => setShowManual(true)}>
          <Keyboard className="size-4" /> Escriu el codi a mà
        </button>
      )}
    </Sheet>
  );
}
