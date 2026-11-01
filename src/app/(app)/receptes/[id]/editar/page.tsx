"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { RecipeEditor } from "@/components/recipe-editor";
import { PageHeader, Spinner } from "@/components/ui";
import { usePermissions } from "@/components/household";
import { canModify } from "@/lib/permissions";
import { draftFromRecipe, loadRecipe, type RecipeDraft } from "@/lib/recipes";

export default function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [initial, setInitial] = useState<RecipeDraft | null | undefined>(undefined);
  const [allowed, setAllowed] = useState(true);
  const perms = usePermissions();

  useEffect(() => {
    loadRecipe(id).then((r) => {
      setAllowed(!r || canModify(perms, r));
      setInitial(r && draftFromRecipe(r));
    });
  }, [id, perms]);

  if (initial === undefined) {
    return (
      <div className="grid place-items-center py-16">
        <Spinner />
      </div>
    );
  }
  if (initial === null) return <p className="py-16 text-center text-muted">No s'ha trobat la recepta.</p>;
  if (!allowed) {
    return (
      <div className="py-16 text-center">
        <p className="mb-2 font-semibold">Aquesta recepta no la pots editar</p>
        <p className="mb-4 text-sm text-muted">Només qui l'ha afegit o una persona privilegiada la pot canviar. Pots duplicar-la i fer-ne la teva variació.</p>
        <Link href={`/receptes/nova?copia=${id}`} className="btn-primary">
          Duplica-la
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Edita la recepta" />
      <RecipeEditor initial={initial} recipeId={id} />
    </>
  );
}
