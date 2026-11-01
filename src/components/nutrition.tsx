"use client";

import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import { evaluatePlate, plateShares, type PlateEvaluation } from "@/lib/harvard";
import { roundNutrients, type MissingIngredient, type Nutrients, type PlateGrams } from "@/lib/nutrition";

const COLORS = {
  veg: "var(--color-herb)",
  grains: "var(--color-saffron)",
  protein: "var(--color-tomato)",
  empty: "var(--color-line)",
};

export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-start gap-1.5 text-xs text-muted ${className}`}>
      <Info className="mt-px size-3.5 shrink-0" />
      <span>Aproximació orientativa a partir de valors de referència. No és un consell mèdic ni nutricional.</span>
    </p>
  );
}

const fmt = (n: number) => Math.round(n).toLocaleString("ca-ES");

/** Fila compacta de valors: kcal, HC, proteïnes, greixos i fibra. */
export function NutrientsRow({ n, compact = false }: { n: Nutrients; compact?: boolean }) {
  const r = roundNutrients(n);
  const items = [
    { label: compact ? "HC" : "Hidrats", value: r.carbs, title: "Carbohidrats" },
    { label: compact ? "Prot." : "Proteïna", value: r.protein, title: "Proteïnes" },
    { label: compact ? "Greix" : "Greixos", value: r.fat },
    { label: "Fibra", value: r.fiber },
  ];
  if (compact) {
    return (
      <p className="text-xs tabular-nums text-muted">
        <span className="font-semibold text-ink">≈ {fmt(r.kcal)} kcal</span>
        {items.map((i) => (
          <span key={i.label}>
            {" · "}
            {i.label} {i.value} g
          </span>
        ))}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-5 gap-1 text-center">
      <div className="rounded-xl bg-tomato-soft px-1 py-2">
        <p className="text-lg font-bold tabular-nums leading-tight text-tomato">{fmt(r.kcal)}</p>
        <p className="text-[10px] font-semibold uppercase text-tomato">kcal</p>
      </div>
      {items.map((i) => (
        <div key={i.label} className="rounded-xl bg-paper px-1 py-2" title={"title" in i ? String(i.title) : undefined}>
          <p className="text-lg font-bold tabular-nums leading-tight">
            {i.value}
            <span className="text-xs font-semibold text-muted"> g</span>
          </p>
          <p className="truncate text-[10px] font-semibold uppercase tracking-tight text-muted">{i.label}</p>
        </div>
      ))}
    </div>
  );
}

/** Plat dividit: la proporció real de verdura/fruita, cereals i proteïna. */
export function HarvardPlate({ plate, size = 120 }: { plate: PlateGrams; size?: number }) {
  const s = plateShares(plate);
  const parts = s.total
    ? [
        { v: s.vegFruit, c: COLORS.veg },
        { v: s.grains, c: COLORS.grains },
        { v: s.protein, c: COLORS.protein },
      ]
    : [{ v: 1, c: COLORS.empty }];
  const r = 50;
  let angle = -90;
  const arcs = parts
    .filter((p) => p.v > 0.001)
    .map((p) => {
      const start = angle;
      const sweep = p.v * 360;
      angle += sweep;
      if (sweep >= 359.9) return <circle key={p.c} cx="60" cy="60" r={r} fill={p.c} />;
      const a0 = (start * Math.PI) / 180;
      const a1 = ((start + sweep) * Math.PI) / 180;
      const large = sweep > 180 ? 1 : 0;
      const d = `M60 60 L${60 + r * Math.cos(a0)} ${60 + r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${60 + r * Math.cos(a1)} ${60 + r * Math.sin(a1)} Z`;
      return <path key={p.c} d={d} fill={p.c} />;
    });
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Proporcions del plat">
      <circle cx="60" cy="60" r="58" fill="var(--color-card)" stroke="var(--color-line)" strokeWidth="2" />
      {arcs}
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--color-card)" strokeWidth="2" />
      {/* Línies del plat ideal: ½ verdura (dreta), ¼ cereals, ¼ proteïna */}
      <g stroke="var(--color-ink)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.45">
        <line x1="60" y1="8" x2="60" y2="112" />
        <line x1="60" y1="60" x2="8" y2="60" />
      </g>
    </svg>
  );
}

const ADVICE_STYLE: Record<string, string> = {
  equilibrat: "bg-herb-soft text-herb",
  carn_vermella: "bg-saffron-soft text-saffron",
  carn_processada: "bg-saffron-soft text-saffron",
  patates: "bg-saffron-soft text-saffron",
  millor_integral: "bg-saffron-soft text-saffron",
};

export function PlateLegend({ evaluation }: { evaluation: PlateEvaluation }) {
  const s = evaluation.shares;
  const rows = [
    { label: "Verdura i fruita", value: s.vegFruit, target: "½", color: COLORS.veg },
    { label: "Cereals i fècules", value: s.grains, target: "¼", color: COLORS.grains },
    { label: "Proteïna", value: s.protein, target: "¼", color: COLORS.protein },
  ];
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <span className="size-3 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="flex-1">{r.label}</span>
          <span className="font-semibold tabular-nums">{Math.round(r.value * 100)}%</span>
          <span className="w-10 text-right text-xs text-muted">obj. {r.target}</span>
        </li>
      ))}
    </ul>
  );
}

export function AdviceChips({ evaluation }: { evaluation: PlateEvaluation }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {evaluation.advice.map((a) => (
        <li key={a.code} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ADVICE_STYLE[a.code] ?? "bg-tomato-soft text-tomato"}`}>
          {a.text}
        </li>
      ))}
    </ul>
  );
}

/** Barra horitzontal petita amb les tres proporcions (per al menú). */
export function PlateBar({ plate }: { plate: PlateGrams }) {
  const s = plateShares(plate);
  if (!s.total) return null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-line" title="Verdura i fruita · cereals · proteïna">
      <span style={{ width: `${s.vegFruit * 100}%`, background: COLORS.veg }} />
      <span style={{ width: `${s.grains * 100}%`, background: COLORS.grains }} />
      <span style={{ width: `${s.protein * 100}%`, background: COLORS.protein }} />
    </div>
  );
}

export function MissingList({ missing }: { missing: MissingIngredient[] }) {
  if (!missing.length) return null;
  const unique = [...new Map(missing.map((m) => [`${m.name}|${m.in ?? ""}`, m])).values()];
  return (
    <div className="rounded-xl bg-saffron-soft p-3 text-sm">
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="size-4 text-saffron" /> Càlcul incomplet
      </p>
      <p className="mb-2 text-xs text-muted">Aquests ingredients no s'han pogut comptar. Afegeix-ne les dades i el càlcul serà més precís.</p>
      <ul className="flex flex-wrap gap-1.5">
        {unique.map((m) => (
          <li key={`${m.name}|${m.in ?? ""}`}>
            <Link
              href={`/aliments?nom=${encodeURIComponent(m.name)}${m.reason === "sense_pes" ? "&pes=1" : ""}`}
              className="inline-block rounded-full bg-card px-2.5 py-1 text-xs font-semibold ring-1 ring-line"
            >
              {m.name}
              {m.in && <span className="font-normal text-muted"> ({m.in})</span>}
              <span className="font-normal text-muted"> · {m.reason === "sense_pes" ? "falta el pes per unitat" : "sense dades"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Targeta completa per a la fitxa d'una recepta. */
export function RecipeNutritionCard({
  perServing,
  plate,
  missing,
  course,
  isComponent,
}: {
  perServing: Nutrients;
  plate: PlateGrams;
  missing: MissingIngredient[];
  course: string | null;
  isComponent: boolean;
}) {
  const evaluation = evaluatePlate(plate);
  const skipPlate = isComponent || course === "postres" || evaluation.status === "no_avaluable";
  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="mb-2 text-xl font-semibold">Valor nutricional</h2>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Per ració</p>
        <NutrientsRow n={perServing} />
      </div>

      <div>
        <h3 className="mb-2 font-sans text-xs font-bold uppercase tracking-wide text-muted">Plat de Harvard</h3>
        {skipPlate ? (
          <p className="text-sm text-muted">
            {isComponent
              ? "És un preelaborat: es compta dins de les receptes on s'utilitza."
              : course === "postres"
                ? "Les postres no es comparen amb el plat."
                : "No hi ha prou verdura, cereals o proteïna per comparar-ho amb el plat."}
          </p>
        ) : (
          <div className="flex items-center gap-4">
            <HarvardPlate plate={plate} />
            <div className="min-w-0 flex-1 space-y-3">
              <PlateLegend evaluation={evaluation} />
            </div>
          </div>
        )}
        {!skipPlate && (
          <div className="mt-3">
            <AdviceChips evaluation={evaluation} />
          </div>
        )}
      </div>

      <MissingList missing={missing} />
      <Disclaimer />
    </section>
  );
}
