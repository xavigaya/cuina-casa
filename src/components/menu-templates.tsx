"use client";

import { notifyFamily } from "@/lib/push-client";
import { useCallback, useEffect, useState } from "react";
import { CopyPlus, Replace, Save, Trash2 } from "lucide-react";
import { useHousehold, usePermissions } from "./household";
import { Sheet, Spinner, toast } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { templateToRows, weekToTemplate, type MenuTemplate } from "@/lib/cooking";
import { canModify, isProposal } from "@/lib/permissions";
import { undoLatestFor } from "@/lib/proposals";
import { formatShortDate } from "@/lib/dates";
import type { Meal, MealPlanEntry } from "@/lib/types";

type WeekEntry = MealPlanEntry & { recipes: { title: string } | null };

/**
 * Plantilles de menú: desar la setmana que es veu i aplicar-ne una altra
 * (afegint-la als plats que ja hi ha o substituint-los).
 */
export function MenuTemplatesSheet({
  open,
  onClose,
  mondayISO,
  week,
  recipeIds,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  mondayISO: string;
  week: WeekEntry[];
  recipeIds: Set<string>;
  onApplied: () => void;
}) {
  const supabase = supabaseBrowser();
  const { household, members } = useHousehold();
  const perms = usePermissions();
  const [templates, setTemplates] = useState<MenuTemplate[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const savable = weekToTemplate(week, mondayISO);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("menu_templates").select("*").eq("household_id", household.id).order("created_at", { ascending: false });
    setMissing(!!error);
    setTemplates(error ? [] : ((data as MenuTemplate[]) ?? []));
  }, [supabase, household.id]);

  useEffect(() => {
    if (!open) return;
    setName("");
    load();
  }, [open, load]);

  async function save() {
    if (!savable.length) return;
    setBusy("desa");
    const { error } = await supabase
      .from("menu_templates")
      .insert({ household_id: household.id, name: name.trim() || `Setmana del ${formatShortDate(mondayISO)}`, entries: savable, created_by: perms.userId });
    setBusy(null);
    if (error) {
      toast("No s'ha pogut desar la plantilla");
      return;
    }
    toast("Plantilla desada");
    setName("");
    load();
  }

  async function apply(t: MenuTemplate, mode: "afegeix" | "substitueix") {
    if (mode === "substitueix") {
      const mine = week.filter((e) => canModify(perms, e));
      const others = week.length - mine.length;
      const msg =
        `Es trauran els ${mine.length} plats d'aquesta setmana i es posaran els de «${t.name}».` +
        (others ? ` ${others} plats d'altres persones s'hi quedaran.` : "");
      if (!confirm(msg)) return;
    }
    setBusy(t.id);
    const removed: string[] = [];
    if (mode === "substitueix") {
      const ids = week.filter((e) => canModify(perms, e)).map((e) => e.id);
      if (ids.length) {
        const { error } = await supabase.from("meal_plan").delete().in("id", ids);
        if (error) {
          setBusy(null);
          toast("No s'ha pogut buidar la setmana");
          return;
        }
        removed.push(...ids);
      }
    }
    const rows = templateToRows(t.entries, mondayISO, household.id, recipeIds);
    const { data, error } = await supabase.from("meal_plan").insert(rows).select("id");
    setBusy(null);
    if (error) {
      toast("No s'ha pogut aplicar la plantilla");
      onApplied();
      return;
    }
    const added = ((data as { id: string }[] | null) ?? []).map((d) => d.id);
    if (!perms.privileged && added.length) notifyFamily(household.id, { type: "proposta", what: "menu", label: t.name, count: added.length });
    onClose();
    onApplied();
    toast(perms.privileged ? `«${t.name}» aplicada (${added.length} plats)` : `«${t.name}» aplicada com a proposta (${added.length} plats)`, {
      label: "Desfés",
      run: async () => {
        const err = await undoLatestFor("meal_plan", [...added, ...removed]);
        toast(err ?? "Setmana com abans");
        onApplied();
      },
    });
  }

  async function remove(t: MenuTemplate) {
    if (!confirm(`Esborres la plantilla «${t.name}»?`)) return;
    const { error } = await supabase.from("menu_templates").delete().eq("id", t.id);
    if (error) return toast("No s'ha pogut esborrar");
    toast("Plantilla esborrada", {
      label: "Desfés",
      run: async () => {
        const err = await undoLatestFor("menu_templates", [t.id]);
        toast(err ?? "Plantilla recuperada");
        load();
      },
    });
    load();
  }

  const mealCount = (t: MenuTemplate, meal: Meal) => t.entries.filter((e) => e.meal === meal).length;

  return (
    <Sheet open={open} onClose={onClose} title="Plantilles de menú">
      {missing ? (
        <p className="rounded-xl bg-saffron-soft p-3 text-sm">
          Per fer servir plantilles cal executar la migració <code>0006_plantilles_menu.sql</code> a Supabase.
        </p>
      ) : (
        <div className="space-y-5">
          <section className="space-y-2 rounded-2xl bg-card p-4 ring-1 ring-line">
            <p className="font-semibold">Desa aquesta setmana</p>
            {savable.length ? (
              <>
                <p className="text-xs text-muted">
                  {savable.length} plats{week.some(isProposal) ? " (les propostes pendents no hi entren)" : ""}. Després la podràs aplicar a qualsevol setmana.
                </p>
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder={`Setmana del ${formatShortDate(mondayISO)}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    aria-label="Nom de la plantilla"
                  />
                  <button className="btn-primary shrink-0" onClick={save} disabled={busy !== null}>
                    {busy === "desa" ? <Spinner className="!size-4 !border-white/40 !border-t-white" /> : <Save className="size-4" />} Desa
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">Aquesta setmana encara no té plats aprovats per desar.</p>
            )}
          </section>

          <section>
            <p className="mb-2 font-semibold">Aplica una plantilla a aquesta setmana</p>
            {!templates ? (
              <div className="grid place-items-center py-6">
                <Spinner />
              </div>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted">Encara no hi ha cap plantilla desada.</p>
            ) : (
              <ul className="space-y-2">
                {templates.map((t) => {
                  const author = members.find((m) => m.user_id === t.created_by)?.display_name;
                  const titles = [...new Set(t.entries.map((e) => e.title ?? e.note).filter(Boolean))] as string[];
                  return (
                    <li key={t.id} className="rounded-2xl bg-card p-3 ring-1 ring-line">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{t.name}</p>
                          <p className="text-xs text-muted">
                            {t.entries.length} plats · {mealCount(t, "dinar")} dinars, {mealCount(t, "sopar")} sopars
                            {author ? ` · de ${author}` : ""}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-muted">{titles.join(" · ")}</p>
                        </div>
                        {canModify(perms, t) && (
                          <button className="btn-ghost !min-h-0 shrink-0 !p-2 text-muted" onClick={() => remove(t)} aria-label={`Esborra la plantilla ${t.name}`}>
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button className="btn-secondary !min-h-0 !py-2 text-sm" onClick={() => apply(t, "afegeix")} disabled={busy !== null}>
                          {busy === t.id ? <Spinner className="!size-4" /> : <CopyPlus className="size-4" />} Afegeix
                        </button>
                        <button className="btn-secondary !min-h-0 !py-2 text-sm" onClick={() => apply(t, "substitueix")} disabled={busy !== null || week.length === 0}>
                          <Replace className="size-4" /> Substitueix
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {!perms.privileged && <p className="mt-2 text-xs text-muted">Com que ets col·laborador, els plats que afegeixis quedaran com a proposta.</p>}
          </section>
        </div>
      )}
    </Sheet>
  );
}
