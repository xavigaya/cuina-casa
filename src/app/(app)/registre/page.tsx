"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Undo2 } from "lucide-react";
import { useHousehold, usePermissions } from "@/components/household";
import { EmptyState, PageHeader, Spinner, toast } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AREA_LABEL, canUndoGroup, groupEntries, whoName, type ActivityArea, type ActivityEntry, type ActivityGroup } from "@/lib/activity";

const LIMIT = 400;
type Filter = "tot" | "meu" | ActivityArea;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Avui";
  if (d.toDateString() === yesterday.toDateString()) return "Ahir";
  return d.toLocaleDateString("ca", { weekday: "long", day: "numeric", month: "long" });
}

export default function ActivityPage() {
  const supabase = supabaseBrowser();
  const { household, members, user } = useHousehold();
  const perms = usePermissions();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState<Filter>("tot");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .eq("household_id", household.id)
      .order("id", { ascending: false })
      .limit(LIMIT);
    if (error) {
      setMissing(true);
      setEntries([]);
      return;
    }
    setEntries((data as ActivityEntry[]) ?? []);
  }, [supabase, household.id]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`activity_log:${household.id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_log", filter: `household_id=eq.${household.id}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load, supabase, household.id]);

  const groups = useMemo(() => {
    const all = groupEntries(entries ?? []);
    return all.filter((g) => (filter === "tot" ? true : filter === "meu" ? g.user_id === user.id : g.area === filter));
  }, [entries, filter, user.id]);

  const byDay = useMemo(() => {
    const out: { day: string; groups: ActivityGroup[] }[] = [];
    for (const g of groups) {
      const day = dayLabel(g.at);
      if (out.at(-1)?.day === day) out.at(-1)!.groups.push(g);
      else out.push({ day, groups: [g] });
    }
    return out;
  }, [groups]);

  const areas = useMemo(() => {
    const present = new Set(groupEntries(entries ?? []).map((g) => g.area));
    return (Object.keys(AREA_LABEL) as ActivityArea[]).filter((a) => present.has(a));
  }, [entries]);

  async function undo(g: ActivityGroup) {
    setBusy(g.key);
    const { data, error } = await supabase.rpc("undo_actions", { p_ids: g.entries.map((e) => e.id) });
    setBusy(null);
    if (error) {
      toast(error.message.replace(/^.*?ERROR:\s*/, "") || "No s'ha pogut desfer");
      return;
    }
    toast(Number(data) > 0 ? "Desfet" : "Ja estava desfet");
    load();
  }

  const who = (id: string | null) => whoName(id, members, { id: user.id, email: user.email });

  return (
    <>
      <PageHeader
        title="Registre"
        subtitle={perms.privileged ? "Tot el que s'ha fet a casa. Pots desfer qualsevol acció recent." : "Tot el que s'ha fet a casa. Pots desfer les teves accions."}
      />

      {missing ? (
        <EmptyState emoji="🛠️" title="Falta actualitzar la base de dades">
          Per veure el registre cal executar la migració <code>0005_permisos_i_registre.sql</code> a Supabase (SQL Editor).
        </EmptyState>
      ) : !entries ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {(["tot", "meu", ...areas] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 transition ${
                  filter === f ? "bg-ink text-paper ring-ink" : "bg-card text-muted ring-line"
                }`}
              >
                {f === "tot" ? "Tot" : f === "meu" ? "Les meves" : AREA_LABEL[f]}
              </button>
            ))}
          </div>

          {byDay.length === 0 ? (
            <EmptyState emoji="📜" title="Encara no hi ha res">
              Aquí sortiran les receptes, els àpats, la llista i el rebost a mesura que la família hi faci canvis.
            </EmptyState>
          ) : (
            <div className="space-y-6">
              {byDay.map(({ day, groups }) => (
                <section key={day}>
                  <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted first-letter:uppercase">{day}</h2>
                  <ul className="card divide-y divide-line">
                    {groups.map((g) => {
                      const name = who(g.user_id);
                      const undoable = canUndoGroup(g, perms);
                      return (
                        <li key={g.key} className={`flex items-start gap-3 p-3 ${g.undone ? "opacity-55" : ""}`}>
                          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-herb-soft text-sm font-bold text-herb">
                            {name.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={`text-[15px] leading-snug ${g.undone ? "line-through decoration-muted/60" : ""}`}>
                              <span className="font-semibold">{name}</span> {g.text}
                            </p>
                            <p className="mt-0.5 text-xs text-muted">
                              {new Date(g.at).toLocaleTimeString("ca", { hour: "2-digit", minute: "2-digit" })} · {AREA_LABEL[g.area]}
                              {g.undone && g.entries[0].undone_by && <> · desfet per {who(g.entries[0].undone_by)}</>}
                            </p>
                          </div>
                          {undoable && (
                            <button
                              className="btn-secondary !min-h-0 shrink-0 !px-3 !py-1.5 text-sm"
                              onClick={() => undo(g)}
                              disabled={busy !== null}
                              aria-label={`Desfés: ${name} ${g.text}`}
                            >
                              {busy === g.key ? <Spinner className="!size-4" /> : <Undo2 className="size-4" />} Desfés
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {(entries?.length ?? 0) >= LIMIT && (
                <p className="flex items-center justify-center gap-2 text-center text-xs text-muted">
                  <History className="size-4" /> Es mostren les {LIMIT} accions més recents.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
