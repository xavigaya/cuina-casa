"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { useHousehold, usePermissions } from "./household";
import { Spinner, toast } from "./ui";
import { DEFAULT_PUSH_PREFS, currentPush, disablePush, enablePush, pushConfigured, pushSupported, updatePushPrefs, type PushPrefs } from "@/lib/push-client";
import type { PushKind } from "@/lib/push-messages";

const OPTIONS: { id: PushKind; label: string; help: string; privilegedOnly?: boolean; contributorOnly?: boolean }[] = [
  { id: "llista", label: "Llista de la compra", help: "Quan algú hi afegeix productes" },
  { id: "propostes", label: "Propostes", help: "Receptes i plats proposats per revisar", privilegedOnly: true },
  { id: "respostes", label: "Respostes a les meves propostes", help: "Quan aproven o rebutgen el que has proposat" },
];

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-herb" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
    </button>
  );
}

/** Avisos al mòbil quan la família fa canvis (Web Push) */
export function PushSettings() {
  const { household } = useHousehold();
  const { privileged } = usePermissions();
  const [state, setState] = useState<{ endpoint: string; prefs: PushPrefs } | null | undefined>(undefined);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupported(pushSupported());
    if (!pushSupported() || !pushConfigured) {
      setState(null);
      return;
    }
    currentPush()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  async function toggle() {
    setBusy(true);
    if (state) {
      await disablePush();
      setState(null);
      toast("Avisos desactivats en aquest mòbil");
    } else {
      const err = await enablePush(household.id);
      if (err) toast(err);
      else {
        setState(await currentPush());
        toast("Avisos activats 🔔");
      }
    }
    setBusy(false);
  }

  async function setPref(id: PushKind) {
    if (!state) return;
    const prefs = { ...state.prefs, [id]: !state.prefs[id] };
    setState({ ...state, prefs });
    const err = await updatePushPrefs(state.endpoint, prefs);
    if (err) toast("No s'ha pogut desar");
  }

  const options = OPTIONS.filter((o) => !o.privilegedOnly || privileged);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <BellRing className="size-5 text-muted" />
        <div className="flex-1">
          <p className="font-medium">Avisos de la família</p>
          <p className="text-xs text-muted">
            {!pushConfigured
              ? "Falta configurar les claus d'avisos a Vercel (consulta la guia)."
              : !supported
                ? "Aquest navegador no pot rebre avisos. A l'iPhone, instal·la l'app a la pantalla d'inici i obre-la des d'allà."
                : "Arriben encara que l'app estigui tancada."}
          </p>
        </div>
        {state === undefined ? (
          <Spinner className="!size-5" />
        ) : (
          <Switch on={!!state} onChange={toggle} label="Avisos de la família" disabled={busy || !supported || !pushConfigured} />
        )}
      </div>
      {state && (
        <ul className="ml-8 space-y-2 border-l border-line pl-4">
          {options.map((o) => (
            <li key={o.id} className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium">{o.label}</p>
                <p className="text-xs text-muted">{o.help}</p>
              </div>
              <Switch on={state.prefs[o.id] ?? DEFAULT_PUSH_PREFS[o.id]} onChange={() => setPref(o.id)} label={o.label} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
