"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Link2, Plus, Trash2, X } from "lucide-react";
import { useHousehold } from "./household";
import { PhotoSearchSheet } from "./photo-search";
import { Sheet, toast } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ingredientKey, parseIngredientLine } from "@/lib/ingredients";
import { resolveLink, saveRecipe, splitSteps, type RecipeDraft } from "@/lib/recipes";
import { COURSES } from "@/lib/courses";
import { normalizeText, sectionInfo } from "@/lib/sections";
import { UNIT_OPTIONS, formatQuantity } from "@/lib/units";
import { parseQty, qtyToString } from "./fields";
import { deleteUploadedPhoto } from "@/lib/photo-upload";

type Linkable = { id: string; title: string; is_component: boolean };

export function RecipeEditor({ initial, recipeId }: { initial: RecipeDraft; recipeId?: string }) {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const { household, user } = useHousehold();
  const [draft, setDraft] = useState(initial);
  const [steps, setSteps] = useState<string[]>(() => {
    const s = splitSteps(initial.instructions);
    return s.length ? s : [""];
  });
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [linkable, setLinkable] = useState<Linkable[]>([]);
  const [linking, setLinking] = useState<string | null>(null); // nom de l'ingredient
  const [photoOpen, setPhotoOpen] = useState(false);
  const set = <K extends keyof RecipeDraft>(k: K, v: RecipeDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    supabase
      .from("recipes")
      .select("id, title, is_component")
      .eq("household_id", household.id)
      .order("title")
      .then(({ data }: { data: Linkable[] | null }) => setLinkable((data ?? []).filter((r) => r.id !== recipeId)));
  }, [supabase, household.id, recipeId]);

  const parsed = useMemo(
    () => draft.ingredientLines.split("\n").map(parseIngredientLine).filter((x) => x !== null),
    [draft.ingredientLines],
  );
  const titleOf = (id: string | null) => linkable.find((r) => r.id === id)?.title;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setBusy(true);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const instructions = steps.map((s) => s.trim()).filter(Boolean).join("\n");
      const id = await saveRecipe(household.id, user.id, { ...draft, tags, instructions }, linkable, recipeId);
      // Si s'ha canviat una foto pujada a l'app, s'esborra l'antiga del magatzem
      if (initial.image_url && initial.image_url !== draft.image_url) deleteUploadedPhoto(initial.image_url).catch(() => {});
      toast("Recepta desada");
      router.replace(`/receptes/${id}`);
    } catch (err) {
      toast(`No s'ha pogut desar: ${(err as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <>
    <form onSubmit={submit} className="space-y-6">
      {/* Foto */}
      <div>
        {draft.image_url ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.image_url} alt="" className="aspect-[16/10] w-full rounded-[var(--radius-card)] object-cover" referrerPolicy="no-referrer" />
            <div className="absolute bottom-3 right-3 flex gap-2">
              <button type="button" className="btn-secondary !min-h-0 !py-2 shadow" onClick={() => setPhotoOpen(true)}>
                <ImagePlus className="size-4" /> Canvia
              </button>
              <button type="button" className="btn-secondary !min-h-0 !px-2.5 !py-2 shadow" onClick={() => set("image_url", null)} aria-label="Treu la foto">
                <X className="size-4" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="flex aspect-[16/7] w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-line text-muted"
            onClick={() => setPhotoOpen(true)}
          >
            <ImagePlus className="size-7" />
            <span className="text-sm font-semibold">Afegeix una foto del plat</span>
            <span className="text-xs">Puja-la des de l'ordinador o el mòbil, o busca'n una</span>
          </button>
        )}
      </div>

      <div>
        <label className="label" htmlFor="r-titol">
          Títol
        </label>
        <input id="r-titol" className="input !text-lg font-semibold" value={draft.title} onChange={(e) => set("title", e.target.value)} required maxLength={160} />
      </div>

      {/* Tipus de plat */}
      <div>
        <span className="label">Tipus de plat</span>
        <div className="flex flex-wrap gap-2">
          {COURSES.map((c) => (
            <button
              type="button"
              key={c.id}
              className="chip"
              data-active={draft.course === c.id}
              onClick={() => set("course", draft.course === c.id ? null : c.id)}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="r-rac">
            Racions
          </label>
          <input
            id="r-rac"
            className="input"
            type="number"
            min={1}
            max={50}
            value={draft.servings}
            onChange={(e) => set("servings", Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
        <div>
          <label className="label" htmlFor="r-min">
            Temps (minuts)
          </label>
          <input
            id="r-min"
            className="input"
            type="number"
            min={0}
            value={draft.prep_minutes ?? ""}
            onChange={(e) => set("prep_minutes", e.target.value ? Number(e.target.value) : null)}
          />
        </div>
      </div>

      {/* Preelaborat */}
      <div className="card space-y-3 p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-5 accent-[var(--color-tomato)]"
            checked={draft.is_component}
            onChange={(e) => set("is_component", e.target.checked)}
          />
          <span>
            <span className="block font-semibold">És un preelaborat</span>
            <span className="text-sm text-muted">Un sofregit, un brou, una salsa… que es fa servir com a ingredient d'altres receptes.</span>
          </span>
        </label>
        {draft.is_component && (
          <div>
            <span className="label">Quantitat que en surt (opcional)</span>
            <div className="grid grid-cols-2 gap-3">
              <input
                className="input"
                inputMode="decimal"
                placeholder="p. ex. 500"
                value={qtyToString(draft.yield_quantity)}
                onChange={(e) => set("yield_quantity", parseQty(e.target.value.replace(/[^\d.,]/g, "")))}
                aria-label="Quantitat"
              />
              <select className="input" value={draft.yield_unit ?? "g"} onChange={(e) => set("yield_unit", e.target.value)} aria-label="Unitat">
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Serveix per calcular la llista: si una recepta en demana 200 g i aquesta en fa 500 g, se'n compraran els ingredients per a 2/5 parts.
            </p>
          </div>
        )}
      </div>

      {/* Ingredients */}
      <div>
        <label className="label" htmlFor="r-ing">
          Ingredients · un per línia
        </label>
        <textarea
          id="r-ing"
          className="input min-h-44 font-mono !text-[15px] leading-relaxed"
          value={draft.ingredientLines}
          onChange={(e) => set("ingredientLines", e.target.value)}
          placeholder={"400 g d'arròs\n200 g de sofregit de tomàquet\n1 l de brou\n2 cullerades d'oli\nSal"}
        />
        {parsed.length > 0 && (
          <ul className="card mt-2 divide-y divide-line text-sm">
            {parsed.map((p, i) => {
              const linked = resolveLink(p.name, draft.links, linkable);
              return (
                <li key={`${i}-${p.name}`} className="flex items-center gap-2 px-3 py-2">
                  <span aria-hidden>{sectionInfo(p.section).emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{p.name}</span>
                    {p.quantity != null && <span className="ml-1.5 text-muted">{formatQuantity(p.quantity, p.unit)}</span>}
                    {p.optional && <span className="ml-1.5 text-xs text-muted">(opcional)</span>}
                  </span>
                  {linked ? (
                    <span className="flex min-w-0 items-center gap-1 rounded-full bg-herb-soft py-0.5 pl-2 pr-1 text-xs font-semibold text-herb">
                      <Link2 className="size-3 shrink-0" />
                      <span className="truncate">{titleOf(linked) ?? "Recepta"}</span>
                      <button
                        type="button"
                        className="rounded-full p-0.5"
                        onClick={() => set("links", { ...draft.links, [ingredientKey(p.name)]: "" })}
                        aria-label="Treu l'enllaç"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ) : (
                    linkable.length > 0 && (
                      <button type="button" className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted" onClick={() => setLinking(p.name)}>
                        <Link2 className="size-3" /> Enllaça
                      </button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {parsed.length > 0 && linkable.length > 0 && (
          <p className="mt-1.5 text-xs text-muted">
            Enllaça un ingredient amb una altra recepta (p. ex. un sofregit) i, si no en tens a casa, la llista hi afegirà els seus ingredients.
          </p>
        )}
      </div>

      {/* Preparació */}
      <div>
        <span className="label">Preparació</span>
        <StepsEditor steps={steps} onChange={setSteps} />
      </div>

      <div>
        <label className="label" htmlFor="r-tags">
          Etiquetes · separades per comes
        </label>
        <input id="r-tags" className="input" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="ràpida, verdura, nens" />
      </div>

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-semibold text-muted">Adreces de la foto i la recepta</summary>
        <div className="mt-4 space-y-4">
          <div>
            <label className="label" htmlFor="r-img">
              Enllaç de la foto
            </label>
            <input id="r-img" className="input" type="url" value={draft.image_url ?? ""} onChange={(e) => set("image_url", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="r-src">
              Web d'origen
            </label>
            <input id="r-src" className="input" type="url" value={draft.source_url ?? ""} onChange={(e) => set("source_url", e.target.value)} />
          </div>
        </div>
      </details>

      <div className="flex gap-2">
        <button type="button" className="btn-secondary" onClick={() => router.back()}>
          Cancel·la
        </button>
        <button className="btn-primary flex-1" disabled={busy}>
          {busy ? "Desant…" : "Desa la recepta"}
        </button>
      </div>

    </form>

    <LinkSheet
      ingredient={linking}
      recipes={linkable}
      onClose={() => setLinking(null)}
      onPick={(id) => {
        if (linking) set("links", { ...draft.links, [ingredientKey(linking)]: id });
        setLinking(null);
      }}
    />

    <PhotoSearchSheet
      open={photoOpen}
      initialQuery={draft.title}
      onClose={() => setPhotoOpen(false)}
      onPick={(url) => {
        set("image_url", url);
        setPhotoOpen(false);
      }}
    />
    </>
  );
}

/** Llista numerada de passos: cada pas és un camp; Retorn crea el següent. */
function StepsEditor({ steps, onChange }: { steps: string[]; onChange: (s: string[]) => void }) {
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    if (focusIndex == null) return;
    const el = refs.current[focusIndex];
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    setFocusIndex(null);
  }, [focusIndex]);

  // Ajusta l'alçada de cada camp al text
  useEffect(() => {
    refs.current.forEach((el) => {
      if (el) {
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
      }
    });
  }, [steps]);

  const update = (i: number, value: string) => {
    const lines = value.split(/\r?\n/);
    if (lines.length > 1) {
      // S'ha enganxat text amb diverses línies: cada línia, un pas
      const pieces = splitSteps(value);
      const next = [...steps.slice(0, i), ...(pieces.length ? pieces : [""]), ...steps.slice(i + 1)];
      onChange(next);
      setFocusIndex(i + Math.max(pieces.length - 1, 0));
      return;
    }
    onChange(steps.map((s, j) => (j === i ? value : s)));
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const remove = (i: number) => {
    const next = steps.filter((_, j) => j !== i);
    onChange(next.length ? next : [""]);
    setFocusIndex(Math.max(0, i - 1));
  };

  return (
    <div>
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-2 grid size-7 shrink-0 place-items-center rounded-full bg-tomato-soft text-sm font-bold text-tomato" aria-hidden>
              {i + 1}
            </span>
            <textarea
              ref={(el) => {
                refs.current[i] = el;
              }}
              className="input min-h-[2.75rem] resize-none overflow-hidden leading-relaxed"
              rows={1}
              value={step}
              placeholder={i === 0 ? "Escriu el primer pas…" : "Pas següent…"}
              aria-label={`Pas ${i + 1}`}
              enterKeyHint="next"
              onChange={(e) => update(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const before = step.slice(0, el.selectionStart);
                  const after = step.slice(el.selectionEnd);
                  onChange([...steps.slice(0, i), before.trimEnd(), after.trimStart(), ...steps.slice(i + 1)]);
                  setFocusIndex(i + 1);
                } else if (e.key === "Backspace" && step === "" && steps.length > 1) {
                  e.preventDefault();
                  remove(i);
                }
              }}
            />
            <div className="mt-1 flex shrink-0 flex-col">
              <button type="button" className="p-1 text-muted disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Puja el pas">
                <ArrowUp className="size-4" />
              </button>
              <button type="button" className="p-1 text-muted disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Baixa el pas">
                <ArrowDown className="size-4" />
              </button>
            </div>
            <button type="button" className="mt-2.5 shrink-0 p-1 text-muted" onClick={() => remove(i)} aria-label={`Esborra el pas ${i + 1}`}>
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn-ghost mt-2 !px-2 text-sm"
        onClick={() => {
          onChange([...steps, ""]);
          setFocusIndex(steps.length);
        }}
      >
        <Plus className="size-4" /> Afegeix un pas
      </button>
      <p className="text-xs text-muted">Prem Retorn per passar al pas següent. Si enganxes un text, cada línia serà un pas.</p>
    </div>
  );
}

function LinkSheet({
  ingredient,
  recipes,
  onClose,
  onPick,
}: {
  ingredient: string | null;
  recipes: Linkable[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [ingredient]);
  const visible = recipes
    .filter((r) => !query || normalizeText(r.title).includes(normalizeText(query)))
    .sort((a, b) => Number(b.is_component) - Number(a.is_component) || a.title.localeCompare(b.title, "ca"));

  return (
    <Sheet open={!!ingredient} onClose={onClose} title={`Enllaça «${ingredient ?? ""}»`}>
      <p className="mb-3 text-sm text-muted">Tria la recepta que correspon a aquest ingredient.</p>
      <input className="input mb-3" placeholder="Busca una recepta…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <ul className="card max-h-[50dvh] divide-y divide-line overflow-y-auto">
        {visible.map((r) => (
          <li key={r.id}>
            <button type="button" className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left" onClick={() => onPick(r.id)}>
              <span className="font-medium">{r.title}</span>
              {r.is_component && <span className="rounded-full bg-saffron-soft px-2 py-0.5 text-[10px] font-bold uppercase text-saffron">preelaborat</span>}
            </button>
          </li>
        ))}
        {visible.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Cap recepta coincideix.</li>}
      </ul>
    </Sheet>
  );
}
