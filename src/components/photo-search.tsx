"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Sheet, Spinner } from "./ui";
import type { ImageResult } from "@/lib/image-search";

/** Finestra per buscar una foto del plat a Internet i triar-la. */
export function PhotoSearchSheet({
  open,
  initialQuery,
  onClose,
  onPick,
}: {
  open: boolean;
  initialQuery: string;
  onClose: () => void;
  onPick: (url: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ImageResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  async function search(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/image-search?q=${encodeURIComponent(q.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setResults(json.results as ImageResult[]);
    } catch {
      setError("No s'ha pogut fer la cerca. Torna-ho a provar d'aquí a una estona.");
      setResults([]);
    }
    setBusy(false);
  }

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setResults(null);
      setPasted("");
      if (initialQuery.trim()) search(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Busca una foto">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(query);
        }}
      >
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom del plat" aria-label="Què vols buscar" />
        <button className="btn-primary !px-3" disabled={busy || !query.trim()} aria-label="Busca">
          <Search className="size-5" />
        </button>
      </form>

      {busy ? (
        <div className="grid place-items-center py-12">
          <Spinner />
        </div>
      ) : error ? (
        <p className="rounded-xl bg-tomato-soft p-3 text-sm text-tomato">{error}</p>
      ) : results && results.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No hem trobat fotos. Prova amb menys paraules o en castellà (p. ex. «paella», «crema catalana»).</p>
      ) : results ? (
        <>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {results.map((r) => (
              <li key={r.url}>
                <button
                  className="group relative block aspect-square w-full overflow-hidden rounded-xl bg-line/60"
                  onClick={() => onPick(r.url)}
                  title={r.title}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.thumb} alt={r.title} className="size-full object-cover transition group-active:scale-95" loading="lazy" referrerPolicy="no-referrer" />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-left text-[10px] text-white">
                    {r.source}
                    {r.license ? ` · ${r.license}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Fotos amb llicència lliure d'Openverse i Wikimedia Commons.</p>
        </>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-sm text-muted">També pots buscar-la a Google, copiar l'adreça de la imatge i enganxar-la aquí:</p>
        <a
          className="btn-secondary mb-3 w-full"
          href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query || initialQuery)}`}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink className="size-4" /> Obre Google Imatges
        </a>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^https?:\/\//.test(pasted.trim())) onPick(pasted.trim());
          }}
        >
          <input className="input" type="url" inputMode="url" placeholder="https://…" value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Adreça de la imatge" />
          <button className="btn-secondary" disabled={!/^https?:\/\//.test(pasted.trim())}>
            Fes-la servir
          </button>
        </form>
      </div>
    </Sheet>
  );
}
