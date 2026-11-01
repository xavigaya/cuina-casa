"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CookingPot, Minus, Pause, Play, Plus, Sun, Timer, X } from "lucide-react";
import { useHousehold } from "@/components/household";
import { Spinner, toast } from "@/components/ui";
import { CookedSheet } from "@/components/cooked-sheet";
import { loadRecipe, splitSteps } from "@/lib/recipes";
import { formatClock, parseDurations } from "@/lib/cooking";
import { formatQuantity, normalizeUnit, roundQuantity } from "@/lib/units";
import type { RecipeWithIngredients } from "@/lib/types";

interface ActiveTimer {
  id: number;
  label: string;
  step: number;
  total: number;
  /** quan s'acaba (ms) si està en marxa */
  endsAt: number | null;
  /** segons que queden si està aturat */
  left: number;
  done: boolean;
}

/** Xiulet curt amb l'àudio del navegador (no cal cap fitxer) */
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.32);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}

export default function CookingModePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const { household } = useHousehold();
  const [recipe, setRecipe] = useState<RecipeWithIngredients | null | undefined>(undefined);
  const [servings, setServings] = useState<number>(() => Number(search.get("racions")) || household.servings);
  const [step, setStep] = useState(-1); // -1 = ingredients
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [timers, setTimers] = useState<ActiveTimer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [awake, setAwake] = useState<"si" | "no" | "sense">("no");
  const [cookedOpen, setCookedOpen] = useState(false);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    loadRecipe(id).then((r) => {
      setRecipe(r);
      if (r && !search.get("racions")) setServings(r.is_component ? r.servings : household.servings);
    });
  }, [id, household.servings, search]);

  // Pantalla sempre encesa mentre es cuina
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Lock> } };
    if (!nav.wakeLock) {
      setAwake("sense");
      return;
    }
    let lock: Lock | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        lock = await nav.wakeLock!.request("screen");
        if (!cancelled) setAwake("si");
      } catch {
        setAwake("no");
      }
    };
    request();
    const onVisible = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);

  // Rellotge dels temporitzadors
  const running = timers.some((t) => t.endsAt && !t.done);
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(iv);
  }, [running]);

  useEffect(() => {
    const finished = timers.filter((t) => t.endsAt && !t.done && t.endsAt <= now);
    if (!finished.length) return;
    setTimers((prev) => prev.map((t) => (finished.some((f) => f.id === t.id) ? { ...t, done: true, endsAt: null, left: 0 } : t)));
    beep();
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    for (const f of finished) {
      toast(`⏰ Temps! ${f.label} (pas ${f.step + 1})`);
      try {
        if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
          new Notification("Cuina Casa: temps!", { body: `${f.label} · pas ${f.step + 1}`, icon: "/icons/icon-192.png" });
        }
      } catch {}
    }
  }, [now, timers]);

  const steps = useMemo(() => splitSteps(recipe?.instructions), [recipe?.instructions]);
  const total = steps.length;

  const go = useCallback((n: number) => setStep((s) => Math.max(-1, Math.min(total - 1, s + n))), [total]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowRight" || e.key === " ") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  function startTimer(seconds: number, label: string, forStep: number) {
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    } catch {}
    setNow(Date.now());
    setTimers((prev) => [...prev, { id: Date.now() + Math.random(), label, step: forStep, total: seconds, endsAt: Date.now() + seconds * 1000, left: seconds, done: false }]);
  }

  const leftOf = (t: ActiveTimer) => (t.endsAt ? Math.max(0, (t.endsAt - now) / 1000) : t.left);

  if (recipe === undefined) {
    return (
      <div className="fixed inset-0 z-[45] grid place-items-center bg-paper">
        <Spinner />
      </div>
    );
  }
  if (recipe === null) return <p className="py-16 text-center text-muted">No s&apos;ha trobat la recepta.</p>;

  const factor = servings / recipe.servings;
  const durations = step >= 0 ? parseDurations(steps[step]) : [];
  const last = step === total - 1;

  return (
    <div
      className="fixed inset-0 z-[45] flex flex-col bg-paper"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 70) go(dx < 0 ? 1 : -1);
      }}
    >
      {/* Capçalera */}
      <header className="flex items-center gap-2 px-4 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <Link href={`/receptes/${recipe.id}`} className="btn-ghost -ml-2 !px-2" aria-label="Surt del mode cuinar">
          <X className="size-6" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-semibold leading-tight">{recipe.title}</p>
          <p className="flex items-center gap-1 text-xs text-muted">
            {awake === "si" ? (
              <>
                <Sun className="size-3" /> La pantalla no s&apos;apagarà
              </>
            ) : awake === "sense" ? (
              "Aquest navegador no pot mantenir la pantalla encesa"
            ) : (
              `${servings} racions`
            )}
          </p>
        </div>
      </header>

      {/* Progrés */}
      <div className="flex gap-1 px-4">
        {[-1, ...steps.map((_, i) => i)].map((i) => (
          <button
            key={i}
            onClick={() => setStep(i)}
            className={`h-1.5 flex-1 rounded-full transition ${i <= step ? "bg-tomato" : "bg-line"}`}
            aria-label={i === -1 ? "Ingredients" : `Pas ${i + 1}`}
          />
        ))}
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-5 py-6">
        {step === -1 ? (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">Prepara-ho tot</h1>
              <div className="flex items-center gap-1 rounded-full border border-line bg-card p-1">
                <button className="grid size-9 place-items-center rounded-full active:bg-line" onClick={() => setServings((s) => Math.max(1, s - 1))} aria-label="Menys racions">
                  <Minus className="size-4" />
                </button>
                <span className="min-w-16 text-center text-sm font-semibold">{servings} rac.</span>
                <button className="grid size-9 place-items-center rounded-full active:bg-line" onClick={() => setServings((s) => Math.min(50, s + 1))} aria-label="Més racions">
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
            <ul className="card divide-y divide-line">
              {recipe.recipe_ingredients.map((ing) => {
                const unit = normalizeUnit(ing.unit);
                const qty = ing.quantity != null ? formatQuantity(roundQuantity(Number(ing.quantity) * factor, unit === "u" ? null : unit), ing.unit) : "";
                const on = checked.has(ing.id);
                return (
                  <li key={ing.id}>
                    <button
                      className="flex w-full items-center gap-4 px-4 py-3.5 text-left"
                      onClick={() =>
                        setChecked((prev) => {
                          const next = new Set(prev);
                          if (next.has(ing.id)) next.delete(ing.id);
                          else next.add(ing.id);
                          return next;
                        })
                      }
                    >
                      <span className={`grid size-7 shrink-0 place-items-center rounded-full border-2 transition ${on ? "border-herb bg-herb text-white" : "border-line"}`}>
                        {on && <Check className="size-4" strokeWidth={3} />}
                      </span>
                      <span className={`flex-1 text-lg ${on ? "text-muted line-through" : ""}`}>
                        {ing.name}
                        {ing.optional && <span className="ml-1 text-sm text-muted">(opcional)</span>}
                      </span>
                      <span className="text-lg font-semibold tabular-nums text-muted">{qty}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {total === 0 && <p className="mt-6 text-center text-muted">Aquesta recepta no té passos escrits.</p>}
          </>
        ) : (
          <>
            <p className="mb-3 text-sm font-bold uppercase tracking-wider text-tomato">
              Pas {step + 1} de {total}
            </p>
            <p className="text-2xl leading-relaxed sm:text-3xl sm:leading-relaxed">{steps[step]}</p>
            {durations.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {durations.map((d, i) => (
                  <button
                    key={i}
                    className="flex items-center gap-2 rounded-full bg-saffron-soft px-4 py-2.5 font-semibold text-ink ring-1 ring-saffron/40 active:scale-95"
                    onClick={() => startTimer(d.seconds, d.label, step)}
                  >
                    <Timer className="size-5 text-saffron" /> Temporitzador {d.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Temporitzadors actius */}
      {timers.length > 0 && (
        <div className="mx-auto flex w-full max-w-2xl flex-wrap gap-2 px-4 pb-2">
          {timers.map((t) => {
            const left = leftOf(t);
            return (
              <div
                key={t.id}
                className={`flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 text-sm font-semibold shadow-sm ring-1 ${
                  t.done ? "animate-pulse bg-tomato text-white ring-tomato" : "bg-card ring-line"
                }`}
              >
                <button onClick={() => setStep(t.step)} className="flex items-center gap-1.5" title={`Pas ${t.step + 1}`}>
                  <Timer className="size-4" />
                  <span className="tabular-nums">{t.done ? "Temps!" : formatClock(left)}</span>
                  <span className={`text-xs font-normal ${t.done ? "text-white/80" : "text-muted"}`}>pas {t.step + 1}</span>
                </button>
                {!t.done && (
                  <button
                    className="grid size-7 place-items-center rounded-full bg-paper"
                    onClick={() =>
                      setTimers((prev) =>
                        prev.map((x) =>
                          x.id !== t.id ? x : x.endsAt ? { ...x, endsAt: null, left: leftOf(x) } : { ...x, endsAt: Date.now() + x.left * 1000 },
                        ),
                      )
                    }
                    aria-label={t.endsAt ? "Atura" : "Continua"}
                  >
                    {t.endsAt ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  </button>
                )}
                <button
                  className={`grid size-7 place-items-center rounded-full ${t.done ? "bg-white/20" : "bg-paper"}`}
                  onClick={() => setTimers((prev) => prev.filter((x) => x.id !== t.id))}
                  aria-label="Treu el temporitzador"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Navegació */}
      <footer className="safe-bottom border-t border-line bg-paper/95 px-4 pt-3">
        <div className="mx-auto flex max-w-2xl gap-3 pb-3">
          <button className="btn-secondary !min-h-14 flex-1 text-base" onClick={() => go(-1)} disabled={step === -1}>
            <ChevronLeft className="size-5" /> Enrere
          </button>
          {last || total === 0 ? (
            <button className="btn-primary !min-h-14 flex-[2] text-base" onClick={() => setCookedOpen(true)}>
              <CookingPot className="size-5" /> Fet! L&apos;he cuinada
            </button>
          ) : (
            <button className="btn-primary !min-h-14 flex-[2] text-base" onClick={() => go(1)}>
              {step === -1 ? "Comença" : "Següent"} <ChevronRight className="size-5" />
            </button>
          )}
        </div>
      </footer>

      <CookedSheet open={cookedOpen} onClose={() => setCookedOpen(false)} recipeId={recipe.id} servings={servings} onDone={() => router.push(`/receptes/${recipe.id}`)} />
    </div>
  );
}
