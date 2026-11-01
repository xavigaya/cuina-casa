"use client";

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { RecipeEditor } from "@/components/recipe-editor";
import { useHousehold } from "@/components/household";
import { PageHeader, Spinner } from "@/components/ui";
import { IMPORT_DRAFT_KEY, draftFromRecipe, emptyDraft, ingredientToLine, loadRecipe, type RecipeDraft } from "@/lib/recipes";
import { courseFromCategory } from "@/lib/courses";
import type { ImportedRecipe } from "@/lib/recipe-import";

type StoredImport = ImportedRecipe & { translated?: boolean; original?: ImportedRecipe };

function toDraft(r: ImportedRecipe, servings: number): RecipeDraft {
  return {
    ...emptyDraft(servings),
    title: r.title,
    servings: r.servings ?? servings,
    prep_minutes: r.prepMinutes,
    image_url: r.imageUrl,
    source_url: r.sourceUrl,
    instructions: r.instructions,
    course: courseFromCategory(r.category),
    ingredientLines: r.ingredients.map(ingredientToLine).join("\n"),
  };
}

export default function NewRecipePage() {
  const { household } = useHousehold();
  const [drafts, setDrafts] = useState<{ catalan: RecipeDraft; original: RecipeDraft | null } | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [imported, setImported] = useState(false);
  const [copyOf, setCopyOf] = useState<string | null>(null);
  const [copyMissing, setCopyMissing] = useState(false);

  useEffect(() => {
    const copyId = new URLSearchParams(window.location.search).get("copia");
    if (copyId) {
      // Duplicar una recepta per fer-ne una variació
      loadRecipe(copyId).then((r) => {
        if (!r) {
          setCopyMissing(true);
          setDrafts({ catalan: emptyDraft(household.servings), original: null });
          return;
        }
        setCopyOf(r.title);
        setDrafts({ catalan: { ...draftFromRecipe(r), title: `${r.title} (variació)`.slice(0, 160) }, original: null });
      });
      return;
    }
    let catalan = emptyDraft(household.servings);
    let original: RecipeDraft | null = null;
    if (window.location.search.includes("importada")) {
      try {
        const raw = sessionStorage.getItem(IMPORT_DRAFT_KEY);
        if (raw) {
          const r = JSON.parse(raw) as StoredImport;
          catalan = toDraft(r, household.servings);
          if (r.translated && r.original) original = toDraft(r.original, household.servings);
          sessionStorage.removeItem(IMPORT_DRAFT_KEY);
          setImported(true);
        }
      } catch {}
    }
    setDrafts({ catalan, original });
  }, [household.servings]);

  const initial = drafts && (showOriginal && drafts.original ? drafts.original : drafts.catalan);

  return (
    <>
      <PageHeader
        title={copyOf ? "Nova variació" : imported ? "Revisa la recepta" : "Recepta nova"}
        subtitle={
          copyOf
            ? `Còpia de «${copyOf}». Canvia el que vulguis: l'original no es modificarà.`
            : imported
              ? "Importada. Comprova els ingredients abans de desar-la."
              : undefined
        }
      />
      {copyMissing && <p className="mb-4 rounded-xl bg-tomato-soft p-3 text-sm text-tomato">No s'ha trobat la recepta que volies duplicar.</p>}
      {!drafts && (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      )}
      {drafts?.original && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl bg-herb-soft/60 p-3 text-sm">
          <Languages className="mt-0.5 size-4 shrink-0 text-herb" />
          <p className="flex-1">
            {showOriginal
              ? "Estàs veient la recepta original en castellà."
              : "L'hem traduït automàticament del castellà. Revisa-la abans de desar-la: el traductor pot equivocar-se en alguna paraula."}
          </p>
          <button className="shrink-0 font-semibold text-herb underline underline-offset-2" onClick={() => setShowOriginal((v) => !v)}>
            {showOriginal ? "Torna al català" : "Mostra l'original"}
          </button>
        </div>
      )}
      {/* La clau fa que l'editor es reiniciï en canviar entre la traducció i l'original */}
      {initial && <RecipeEditor key={showOriginal ? "original" : "catala"} initial={initial} />}
    </>
  );
}
