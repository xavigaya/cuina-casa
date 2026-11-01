"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Clock, Globe, Link2, Plus, Search, Users } from "lucide-react";
import { useLiveTable } from "@/components/household";
import { EmptyState, PageHeader, Sheet, Spinner } from "@/components/ui";
import { OnlineRecipesSheet, type OnlineSearchRequest } from "@/components/online-recipes";
import { DishesWithoutRecipe } from "@/components/dishes-without-recipe";
import { IMPORT_DRAFT_KEY } from "@/lib/recipes";
import { normalizeText } from "@/lib/sections";
import { COURSES, courseInfo, type Course } from "@/lib/courses";
import type { Recipe } from "@/lib/types";

export default function RecipesPage() {
  const router = useRouter();
  const { rows: recipes, loading, reload } = useLiveTable<Recipe>("recipes", { order: { column: "title" }, realtime: false });
  const [onlineReq, setOnlineReq] = useState<OnlineSearchRequest | null>(null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [course, setCourse] = useState<Course | "base" | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const tags = useMemo(() => [...new Set(recipes.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, "ca")), [recipes]);
  const visible = recipes.filter(
    (r) =>
      (!query || normalizeText(r.title).includes(normalizeText(query))) &&
      (!tag || r.tags.includes(tag)) &&
      (course === "base" ? r.is_component : !course || r.course === course),
  );
  const usedCourses = COURSES.filter((c) => recipes.some((r) => r.course === c.id));
  const hasComponents = recipes.some((r) => r.is_component);

  return (
    <>
      <PageHeader
        title="Receptes"
        subtitle={recipes.length ? `${recipes.length} receptes` : undefined}
        action={
          <div className="flex gap-2">
            <button className="btn-secondary !px-3" onClick={() => setOnlineReq({})} aria-label="Cerca receptes a Internet">
              <Globe className="size-5" />
            </button>
            <button className="btn-secondary !px-3" onClick={() => setImportOpen(true)} aria-label="Importa des d'un enllaç">
              <Link2 className="size-5" />
            </button>
            <Link href="/receptes/nova" className="btn-primary !px-3" aria-label="Recepta nova">
              <Plus className="size-5" />
            </Link>
          </div>
        }
      />

      {!loading && <DishesWithoutRecipe recipes={recipes} />}

      {recipes.length > 0 && (
        <>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input className="input !rounded-full !pl-10" placeholder="Busca una recepta…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {(usedCourses.length > 0 || hasComponents) && (
            <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
              <button className="chip" data-active={!course} onClick={() => setCourse(null)}>
                Totes
              </button>
              {usedCourses.map((c) => (
                <button key={c.id} className="chip" data-active={course === c.id} onClick={() => setCourse(course === c.id ? null : c.id)}>
                  {c.emoji} {c.plural}
                </button>
              ))}
              {hasComponents && (
                <button className="chip" data-active={course === "base"} onClick={() => setCourse(course === "base" ? null : "base")}>
                  🫙 Preelaborats
                </button>
              )}
            </div>
          )}
          {tags.length > 0 && (
            <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
              <button className="chip" data-active={!tag} onClick={() => setTag(null)}>
                # Totes
              </button>
              {tags.map((t) => (
                <button key={t} className="chip" data-active={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                  # {t}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : recipes.length === 0 ? (
        <EmptyState emoji="📖" title="Encara no hi ha receptes">
          <p>Escriu-ne una o importa-la enganxant l'enllaç d'una web de cuina.</p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn-secondary" onClick={() => setImportOpen(true)}>
              <Link2 className="size-4" /> Importa
            </button>
            <Link href="/receptes/nova" className="btn-primary">
              <Plus className="size-4" /> Nova
            </Link>
          </div>
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visible.map((r) => (
            <li key={r.id}>
              <Link href={`/receptes/${r.id}`} className="card block h-full overflow-hidden transition active:scale-[0.98]">
                <div className="relative aspect-[4/3] bg-line/60">
                  {(courseInfo(r.course) || r.is_component) && (
                    <span className="absolute left-2 top-2 rounded-full bg-paper/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink shadow-sm">
                      {r.is_component ? "Preelaborat" : courseInfo(r.course)!.label}
                    </span>
                  )}
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image_url} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="grid size-full place-items-center text-4xl" aria-hidden>
                      🍽️
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 font-semibold leading-snug">{r.title}</p>
                  <p className="mt-1 flex items-center gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <Users className="size-3" /> {r.servings}
                    </span>
                    {r.prep_minutes && (
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" /> {r.prep_minutes} min
                      </span>
                    )}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <OnlineRecipesSheet request={onlineReq} onClose={() => setOnlineReq(null)} onImported={reload} />

      <ImportSheet
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(draft) => {
          try {
            sessionStorage.setItem(IMPORT_DRAFT_KEY, JSON.stringify(draft));
          } catch {}
          router.push("/receptes/nova?importada=1");
        }}
      />
    </>
  );
}

function ImportSheet({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (d: unknown) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/import-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No s'ha pogut importar");
      onImported(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Importa una recepta">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="url">
            Enllaç de la recepta
          </label>
          <input
            id="url"
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            autoFocus
          />
          <p className="mt-1.5 text-xs text-muted">Funciona amb la majoria de webs de cuina. Podràs revisar-la abans de desar-la.</p>
        </div>
        {error && <p className="rounded-xl bg-tomato-soft p-3 text-sm text-tomato">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !url}>
          {busy ? "Llegint la recepta…" : "Importa"}
        </button>
      </form>
    </Sheet>
  );
}
