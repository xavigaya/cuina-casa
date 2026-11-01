"use client";

import Link from "next/link";
import { useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { Disclaimer, NutrientsRow, PlateBar } from "./nutrition";
import { dayName } from "@/lib/dates";
import { PROTEIN_KINDS, type Proposal } from "@/lib/harvard";
import type { DayAnalysis, WeekAnalysis, WeekendSlot } from "@/lib/menu-analysis";

export function WeekSummary({ analysis }: { analysis: WeekAnalysis }) {
  return (
    <section className="card mb-6 space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-sans text-xs font-bold uppercase tracking-wide text-muted">Mitjana diària per persona</h2>
        <span className="text-xs text-muted">
          {analysis.daysWithData} {analysis.daysWithData === 1 ? "dia" : "dies"} amb dades
        </span>
      </div>
      {analysis.average && <NutrientsRow n={analysis.average} />}
      {analysis.evaluation.status !== "no_avaluable" && (
        <div>
          <p className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted">
            <span>Plat de la setmana</span>
            <span className="tabular-nums">
              verdura {Math.round(analysis.evaluation.shares.vegFruit * 100)}% · cereals {Math.round(analysis.evaluation.shares.grains * 100)}% · proteïna{" "}
              {Math.round(analysis.evaluation.shares.protein * 100)}%
            </span>
          </p>
          <PlateBar plate={analysis.plate} />
        </div>
      )}
      <div>
        <p className="mb-1.5 text-xs text-muted">Proteïnes de la setmana</p>
        <ul className="flex flex-wrap gap-1.5">
          {PROTEIN_KINDS.map((k) => {
            const n = analysis.proteins[k.id];
            const low = k.min != null && n < k.min;
            const high = k.max != null && n > k.max;
            return (
              <li
                key={k.id}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${low || high ? "bg-saffron-soft text-saffron" : "bg-herb-soft text-herb"}`}
                title={k.min ? `Recomanat: ${k.min} o més` : `Recomanat: ${k.max} com a màxim`}
              >
                {k.label} {n}
                {k.min ? `/${k.min}` : ""}
                {high ? " ↑" : ""}
              </li>
            );
          })}
        </ul>
      </div>
      {analysis.incomplete && <p className="text-xs text-muted">* Alguns plats no tenen recepta o els falten dades: els totals són incomplets.</p>}
      <Disclaimer />
    </section>
  );
}

export function DayFooter({ analysis, onAdd }: { analysis: DayAnalysis; onAdd: (p: Proposal) => void }) {
  if (analysis.counted === 0 && !analysis.imbalance) return null;
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      {analysis.counted > 0 && (
        <div className="space-y-1.5">
          <NutrientsRow n={analysis.totals} compact />
          <PlateBar plate={analysis.plate} />
          {(analysis.incomplete || analysis.unknown > 0) && <p className="text-[11px] text-muted">* Total incomplet</p>}
        </div>
      )}
      {analysis.imbalance && <Proposals proposals={analysis.proposals} title="Per al sopar" onAdd={onAdd} reasonFallback="Avui" />}
    </div>
  );
}

function Proposals({
  proposals,
  title,
  onAdd,
  reasonFallback,
}: {
  proposals: Proposal[];
  title: string;
  onAdd: (p: Proposal) => void;
  reasonFallback: string;
}) {
  return (
    <div className="rounded-2xl bg-herb-soft/60 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-herb">
        <Lightbulb className="size-4" /> {title}
      </p>
      {proposals.length === 0 ? (
        <p className="text-sm text-muted">
          {reasonFallback === "Avui" ? "Avui hi ha algun desequilibri" : "La setmana té algun desequilibri"}, però cap recepta guardada no el compensa prou.
          Prova d'afegir receptes amb més verdura, peix o llegums.
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm">{proposals[0].reason}.</p>
          <ul className="space-y-1.5">
            {proposals.map((p) => (
              <li key={p.recipes.map((r) => r.id).join("+")} className="flex items-center gap-2 rounded-xl bg-card px-3 py-2">
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {p.recipes.map((r, i) => (
                    <span key={r.id}>
                      {i > 0 && " i "}
                      <Link href={`/receptes/${r.id}`} className="underline decoration-line underline-offset-2">
                        {r.title}
                      </Link>
                    </span>
                  ))}
                </span>
                <button className="flex shrink-0 items-center gap-1 rounded-full bg-herb px-3 py-1 text-xs font-bold text-paper" onClick={() => onAdd(p)}>
                  <Plus className="size-3.5" /> Afegeix
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function WeekendCard({
  proposals,
  slots,
  onAdd,
}: {
  proposals: Proposal[];
  slots: WeekendSlot[];
  onAdd: (slot: WeekendSlot, p: Proposal) => void;
}) {
  const [slotIndex, setSlotIndex] = useState(0);
  const slot = slots[Math.min(slotIndex, slots.length - 1)];
  return (
    <section className="card space-y-3 border-herb/40 p-4">
      <h2 className="font-sans text-sm font-bold">Per tancar la setmana</h2>
      {proposals.length > 0 && (
        <div className="-mx-1 flex flex-wrap gap-1.5 px-1">
          {slots.map((s, i) => (
            <button key={`${s.day}${s.meal}`} className="chip !py-1 text-xs" data-active={i === slotIndex} onClick={() => setSlotIndex(i)}>
              <span className="capitalize">{dayName(new Date(`${s.day}T00:00`))}</span> · {s.meal}
            </button>
          ))}
        </div>
      )}
      <Proposals proposals={proposals} title="Propostes per equilibrar" onAdd={(p) => onAdd(slot, p)} reasonFallback="Setmana" />
    </section>
  );
}
