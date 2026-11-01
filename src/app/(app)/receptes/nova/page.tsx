"use client";

import { useEffect, useState } from "react";
import { RecipeEditor } from "@/components/recipe-editor";
import { useHousehold } from "@/components/household";
import { PageHeader } from "@/components/ui";
import { IMPORT_DRAFT_KEY, emptyDraft, ingredientToLine, type RecipeDraft } from "@/lib/recipes";
import type { ImportedRecipe } from "@/lib/recipe-import";

export default function NewRecipePage() {
  const { household } = useHousehold();
  const [initial, setInitial] = useState<RecipeDraft | null>(null);
  const [imported, setImported] = useState(false);

  useEffect(() => {
    const empty = emptyDraft(household.servings);
    let draft = empty;
    if (window.location.search.includes("importada")) {
      try {
        const raw = sessionStorage.getItem(IMPORT_DRAFT_KEY);
        if (raw) {
          const r = JSON.parse(raw) as ImportedRecipe;
          draft = {
            ...empty,
            title: r.title,
            servings: r.servings ?? household.servings,
            prep_minutes: r.prepMinutes,
            image_url: r.imageUrl,
            source_url: r.sourceUrl,
            instructions: r.instructions,
            ingredientLines: r.ingredients.map(ingredientToLine).join("\n"),
          };
          sessionStorage.removeItem(IMPORT_DRAFT_KEY);
          setImported(true);
        }
      } catch {}
    }
    setInitial(draft);
  }, [household.servings]);

  return (
    <>
      <PageHeader title={imported ? "Revisa la recepta" : "Recepta nova"} subtitle={imported ? "Importada. Comprova els ingredients abans de desar-la." : undefined} />
      {initial && <RecipeEditor initial={initial} />}
    </>
  );
}
