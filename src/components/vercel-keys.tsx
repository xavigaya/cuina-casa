"use client";

import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { toast } from "./ui";
import { generateSecret, generateVapidKeys } from "@/lib/vercel-keys";

type Keys = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; CRON_SECRET: string };

/**
 * Genera al navegador les claus per a les variables d'entorn de Vercel.
 * No es desen ni s'envien enlloc: només es mostren per copiar-les.
 */
export function VercelKeys() {
  const [keys, setKeys] = useState<Keys | null>(null);

  async function generate() {
    try {
      const vapid = await generateVapidKeys();
      setKeys({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, CRON_SECRET: generateSecret() });
    } catch {
      toast("Aquest navegador no pot generar les claus");
    }
  }

  return (
    <div className="flex items-start gap-3">
      <KeyRound className="mt-0.5 size-5 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Claus per a Vercel</p>
        <p className="text-sm text-muted">
          Genera claus noves per als avisos i el secret de la tasca diària. Es creen en aquest dispositiu i no s&apos;envien enlloc: copia-les a
          Vercel → Settings → Environment Variables i torna a publicar.
        </p>
        {!keys ? (
          <button className="btn-secondary mt-2" onClick={generate}>
            <KeyRound className="size-4" /> Genera claus noves
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            {(Object.keys(keys) as (keyof Keys)[]).map((name) => (
              <div key={name} className="rounded-xl bg-paper p-2.5 ring-1 ring-line">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs font-bold">{name}</code>
                  <button
                    className="btn-ghost !min-h-0 !p-1.5"
                    onClick={async () => {
                      await navigator.clipboard.writeText(keys[name]);
                      toast(`${name} copiada`);
                    }}
                    aria-label={`Copia ${name}`}
                  >
                    <Copy className="size-4" />
                  </button>
                </div>
                <code className="block break-all text-xs text-muted">{keys[name]}</code>
              </div>
            ))}
            <p className="text-xs text-muted">
              Si canvies les claus d&apos;avisos, cada mòbil es tornarà a subscriure sol la propera vegada que obri l&apos;app. La clau privada i el
              secret no s&apos;han de compartir amb ningú. Quan les hagis copiat, tanca aquesta pàgina.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
