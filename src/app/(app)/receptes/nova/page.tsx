"use client";

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { RecipeEditor } from "@/components/recipe-editor";
import { useHousehold } from "@/components/household";
import { PageHeader } from "@/components/ui";
import { IMPORT_DRAFT_KEY, emptyDraft, ingredientToLine, type RecipeDraft } from "@/lib/recipes";
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

  useEffect(() => {
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
      <PageHeader title={imported ? "Revisa la recepta" : "Recepta nova"} subtitle={imported ? "Importada. Comprova els ingredients abans de desar-la." : undefined} />
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
