"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Clock, ExternalLink, Globe, Plus, Search } from "lucide-react";
import { useHousehold } from "./household";
import { Disclaimer, HarvardPlate } from "./nutrition";
import { Sheet, Spinner, toast } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { importOnlineRecipe, type OnlineRecipe } from "@/lib/online-recipes";
import { courseInfo } from "@/lib/courses";
import { SITES } from "@/lib/recipe-sites";
import type { Imbalance } from "@/lib/harvard";
import type { Meal } from "@/lib/types";

export interface OnlineSearchRequest {
  imbalance?: Imbalance | null;
  reason?: string;
  /** Àpat del menú on s'afegirà la recepta importada */
  target?: { day: string; meal: Meal } | null;
  query?: string;
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  equilibrat: { text: "Equilibrada", className: "bg-herb-soft text-herb" },
  millorable: { text: "Millorable", className: "bg-saffron-soft text-saffron" },
  desequilibrat: { text: "Poc equilibrada", className: "bg-tomato-soft text-tomato" },
  no_avaluable: { text: "Sense valorar", className: "bg-line text-muted" },
};

export function OnlineRecipesSheet({
  request,
  onClose,
  onImported,
}: {
  request: OnlineSearchRequest | null;
  onClose: () => void;
  onImported?: () => void;
}) {
  const supabase = supabaseBrowser();
  const { household, user } = useHousehold();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OnlineRecipe[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState<string | null>(null);

  async function search(params: { query?: string; imbalance?: Imbalance | null }) {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/recipe-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: params.query, imbalance: params.imbalance ?? undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setResults(json.results as OnlineRecipe[]);
    } catch {
      setError("No s'ha pogut fer la cerca. Pot ser que alguna web no respongui; torna-ho a provar d'aquí a una estona.");
    }
    setBusy(false);
  }

  useEffect(() => {
    if (!request) return;
    setImported({});
    setQuery(request.query ?? "");
    setResults(null);
    setError(null);
    if (request.imbalance || request.query) search({ query: request.query, imbalance: request.imbalance });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  async function importIt(r: OnlineRecipe) {
    setImporting(r.url);
    try {
      const id = await importOnlineRecipe(household.id, user.id, r, household.servings);
      if (request?.target) {
        await supabase.from("meal_plan").insert({ household_id: household.id, day: request.target.day, meal: request.target.meal, recipe_id: id });
      }
      setImported((m) => ({ ...m, [r.url]: id }));
      toast(request?.target ? "Importada i afegida al menú" : "Recepta importada");
      onImported?.();
    } catch (e) {
      toast(`No s'ha pogut importar: ${(e as Error).message}`);
    }
    setImporting(null);
  }

  return (
    <Sheet open={!!request} onClose={onClose} title="Receptes a Internet">
      {request?.reason && <p className="mb-3 rounded-xl bg-herb-soft/60 p-3 text-sm">{request.reason}.</p>}

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) search({ query: query.trim(), imbalance: request?.imbalance });
        }}
      >
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={request?.imbalance ? "O busca un plat concret…" : "Què vols cuinar? (p. ex. lentejas)"}
          aria-label="Què vols buscar"
        />
        <button className="btn-primary !px-3" disabled={busy || !query.trim()} aria-label="Busca">
          <Search className="size-5" />
        </button>
      </form>

      {busy ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner />
          <p className="text-sm text-muted">Buscant a {SITES.map((s) => s.name).join(", ")}…</p>
          <p className="text-xs text-muted">Pot trigar uns segons.</p>
        </div>
      ) : error ? (
        <p className="rounded-xl bg-tomato-soft p-3 text-sm text-tomato">{error}</p>
      ) : results && results.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No hem trobat receptes que es puguin importar. Prova amb altres paraules, millor en castellà.</p>
      ) : results ? (
        <ul className="space-y-3">
          {results.map((r) => {
            const status = r.evaluation ? STATUS_LABEL[r.evaluation.status] : null;
            const done = imported[r.url];
            return (
              <li key={r.url} className="card overflow-hidden">
                {r.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                )}
                <div className="space-y-3 p-4">
                  <div>
                    <p className="font-display text-lg font-semibold leading-snug">{r.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span className="flex items-center gap-1">
                        <Globe className="size-3" /> {r.site}
                      </span>
                      {r.prepMinutes && (
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" /> {r.prepMinutes} min
                        </span>
                      )}
                      {courseInfo(r.course) && <span>{courseInfo(r.course)!.label}</span>}
                      {r.perServing && <span>≈ {r.perServing.kcal} kcal/ració</span>}
                    </p>
                  </div>
                  {r.plate && r.evaluation && r.evaluation.status !== "no_avaluable" && (
                    <div className="flex items-center gap-3">
                      <HarvardPlate plate={r.plate} size={56} />
                      <div className="min-w-0 flex-1">
                        {request?.imbalance && r.compensates.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {r.compensates.map((t) => (
                              <span key={t} className="rounded-full bg-herb-soft px-2 py-0.5 text-xs font-bold text-herb">
                                {t}
                              </span>
                            ))}
                          </span>
                        ) : (
                          status && <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${status.className}`}>{status.text}</span>
                        )}
                        <p className="mt-1 text-xs text-muted">{r.evaluation.advice.slice(0, 2).join(" · ")}</p>
                      </div>
                    </div>
                  )}
                  {r.incomplete && <p className="text-xs text-muted">* Alguns ingredients no s'han pogut valorar.</p>}
                  <div className="flex flex-wrap gap-2">
                    {done ? (
                      <Link href={`/receptes/${done}`} className="btn-secondary flex-1 !text-herb">
                        <Check className="size-4" /> Importada · obre-la
                      </Link>
                    ) : (
                      <button className="btn-primary flex-1" onClick={() => importIt(r)} disabled={importing !== null}>
                        <Plus className="size-4" />
                        {importing === r.url ? "Important…" : request?.target ? "Importa i afegeix al menú" : "Importa"}
                      </button>
                    )}
                    <a href={r.url} target="_blank" rel="noreferrer" className="btn-secondary !px-3" aria-label="Obre la web original">
                      <ExternalLink className="size-4" />
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mt-5 space-y-1.5">
        <p className="text-xs text-muted">Receptes de webs externes. La valoració és aproximada i es calcula amb els ingredients que publica cada web.</p>
        <Disclaimer />
      </div>
    </Sheet>
  );
}
