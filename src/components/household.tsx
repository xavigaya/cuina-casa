"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Household, Member } from "@/lib/types";
import { Onboarding } from "./onboarding";
import { Spinner } from "./ui";

interface HouseholdContextValue {
  user: User;
  household: Household;
  members: Member[];
  refresh: () => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function useHousehold() {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHousehold fora de HouseholdProvider");
  return ctx;
}

const STORAGE_KEY = "cuina-casa:llar";

/**
 * Carrega l'usuari i la seva llar. Si encara no en té cap,
 * mostra la pantalla per crear-ne una o unir-s'hi amb un codi.
 */
export function HouseholdProvider({ children }: { children: ReactNode }) {
  const supabase = supabaseBrowser();
  const [user, setUser] = useState<User | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      window.location.href = "/login";
      return;
    }
    setUser(auth.user);

    const { data: memberships, error: mErr } = await supabase
      .from("household_members")
      .select("household_id, households(*)")
      .eq("user_id", auth.user.id);
    if (mErr) {
      setError(mErr.message);
      setLoading(false);
      return;
    }

    const all = (memberships ?? [])
      .map((m: { households: Household | Household[] | null }) =>
        Array.isArray(m.households) ? m.households[0] : m.households,
      )
      .filter(Boolean) as Household[];

    let preferred: string | null = null;
    try {
      preferred = localStorage.getItem(STORAGE_KEY);
    } catch {}
    const current = all.find((h) => h.id === preferred) ?? all[0] ?? null;
    setHousehold(current);

    if (current) {
      try {
        localStorage.setItem(STORAGE_KEY, current.id);
      } catch {}
      const { data: mem } = await supabase.from("household_members").select("*").eq("household_id", current.id);
      setMembers((mem as Member[]) ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="mb-2 font-semibold">No s'han pogut carregar les dades</p>
        <p className="mb-4 text-sm text-muted">{error}</p>
        <button className="btn-primary" onClick={() => load()}>
          Torna-ho a provar
        </button>
      </div>
    );
  }

  if (!user) return null;
  if (!household) return <Onboarding user={user} onDone={load} />;

  return (
    <HouseholdContext.Provider value={{ user, household, members, refresh: load }}>
      {children}
    </HouseholdContext.Provider>
  );
}

/**
 * Llegeix una taula de la llar i s'actualitza sola quan algú de la família
 * hi fa canvis (temps real de Supabase).
 */
export function useLiveTable<T>(
  table: string,
  options: {
    select?: string;
    order?: { column: string; ascending?: boolean };
    filter?: (q: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
    realtime?: boolean;
    deps?: unknown[];
    /** Desa una còpia local per poder-la veure sense connexió */
    offlineKey?: string;
  } = {},
) {
  const { household } = useHousehold();
  const supabase = supabaseBrowser();
  const cacheKey = options.offlineKey ? `cuina-casa:copia:${household.id}:${options.offlineKey}` : null;
  const [rows, setRows] = useState<T[]>(() => {
    if (!cacheKey || typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem(cacheKey) ?? "[]") as T[];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(rows.length === 0);
  const optsRef = useRef(options);
  optsRef.current = options;

  const reload = useCallback(async () => {
    const o = optsRef.current;
    let q = supabase.from(table).select(o.select ?? "*").eq("household_id", household.id);
    if (o.filter) q = o.filter(q);
    if (o.order) q = q.order(o.order.column, { ascending: o.order.ascending ?? true });
    const { data, error } = await q;
    if (!error) {
      setRows((data as T[]) ?? []);
      if (cacheKey) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(data ?? []));
        } catch {}
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, table, household.id, cacheKey, ...(options.deps ?? [])]);

  useEffect(() => {
    reload();
    if (options.realtime === false) return;
    const channel = supabase
      .channel(`${table}:${household.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `household_id=eq.${household.id}` },
        () => reload(),
      )
      .subscribe();
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload, supabase, table, household.id, options.realtime]);

  return { rows, setRows, loading, reload };
}
