"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useHousehold } from "./household";
import { toast } from "./ui";
import { parseIngredientLine } from "@/lib/ingredients";
import { saveRecipe, type RecipeDraft } from "@/lib/recipes";
import { sectionInfo } from "@/lib/sections";
import { formatQuantity } from "@/lib/units";

export function RecipeEditor({ initial, recipeId }: { initial: RecipeDraft; recipeId?: string }) {
  const router = useRouter();
  const { household, user } = useHousehold();
  const [draft, setDraft] = useState(initial);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof RecipeDraft>(k: K, v: RecipeDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const parsed = useMemo(
    () => draft.ingredientLines.split("\n").map(parseIngredientLine).filter((x) => x !== null),
    [draft.ingredientLines],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setBusy(true);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const id = await saveRecipe(household.id, user.id, { ...draft, tags }, recipeId);
      toast("Recepta desada");
      router.replace(`/receptes/${id}`);
    } catch (err) {
      toast(`No s'ha pogut desar: ${(err as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label className="label" htmlFor="r-titol">
          Títol
        </label>
        <input id="r-titol" className="input !text-lg font-semibold" value={draft.title} onChange={(e) => set("title", e.target.value)} required maxLength={160} />
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

      <div>
        <label className="label" htmlFor="r-ing">
          Ingredients · un per línia
        </label>
        <textarea
          id="r-ing"
          className="input min-h-44 font-mono !text-[15px] leading-relaxed"
          value={draft.ingredientLines}
          onChange={(e) => set("ingredientLines", e.target.value)}
          placeholder={"400 g de macarrons\n1 llauna de tomàquet triturat\n1 ceba\n2 cullerades d'oli\nSal"}
        />
        {parsed.length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-muted">Com ho hem entès ({parsed.length})</summary>
            <ul className="mt-2 space-y-1">
              {parsed.map((p, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span aria-hidden>{sectionInfo(p.section).emoji}</span>
                  <span className="font-medium">{p.name}</span>
                  {p.quantity != null && <span className="text-muted">{formatQuantity(p.quantity, p.unit)}</span>}
                  {p.optional && <span className="text-xs text-muted">(opcional)</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div>
        <label className="label" htmlFor="r-pas">
          Preparació
        </label>
        <textarea
          id="r-pas"
          className="input min-h-44 leading-relaxed"
          value={draft.instructions}
          onChange={(e) => set("instructions", e.target.value)}
          placeholder="Escriu cada pas en una línia nova."
        />
      </div>

      <div>
        <label className="label" htmlFor="r-tags">
          Etiquetes · separades per comes
        </label>
        <input id="r-tags" className="input" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="ràpida, verdura, nens" />
      </div>

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-semibold text-muted">Foto i enllaç</summary>
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
  );
}
