"use client";

import { use, useEffect, useState } from "react";
import { RecipeEditor } from "@/components/recipe-editor";
import { PageHeader, Spinner } from "@/components/ui";
import { ingredientsToLines, loadRecipe, type RecipeDraft } from "@/lib/recipes";

export default function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [initial, setInitial] = useState<RecipeDraft | null | undefined>(undefined);

  useEffect(() => {
    loadRecipe(id).then((r) =>
      setInitial(
        r && {
          title: r.title,
          servings: r.servings,
          prep_minutes: r.prep_minutes,
          image_url: r.image_url,
          source_url: r.source_url,
          instructions: r.instructions ?? "",
          tags: r.tags,
          ingredientLines: ingredientsToLines(r.recipe_ingredients),
        },
      ),
    );
  }, [id]);

  if (initial === undefined) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  }
  if (initial === null) return <p className="py-16 text-center text-muted">No s'ha trobat la recepta.</p>;

  return (
    <>
      <PageHeader title="Edita la recepta" />
      <RecipeEditor initial={initial} recipeId={id} />
    </>
  );
}
