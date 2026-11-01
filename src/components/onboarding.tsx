"use client";

import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";

export function Onboarding({ user, onDone }: { user: User; onDone: () => void }) {
  const supabase = supabaseBrowser();
  const firstName = (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? "";
  const [mode, setMode] = useState<"crear" | "unir">("crear");
  const [name, setName] = useState("Casa");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState(firstName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } =
      mode === "crear"
        ? await supabase.rpc("create_household", { p_name: name.trim(), p_display_name: displayName.trim() || null })
        : await supabase.rpc("join_household", { p_code: code.trim(), p_display_name: displayName.trim() || null });
    setBusy(false);
    if (error || (mode !== "crear" && !data)) {
      setError(
        !error || error.message.includes("no vàlid")
          ? "Aquest codi no és vàlid. Revisa'l amb qui te l'ha passat."
          : error.message,
      );
      return;
    }
    onDone();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-6">
      <div className="mb-8 text-center">
        <div className="mb-3 text-5xl" aria-hidden>
          🍲
        </div>
        <h1 className="text-3xl font-semibold">Hola{firstName ? `, ${firstName}` : ""}!</h1>
        <p className="mt-2 text-muted">Per començar, crea la llar de la família o uneix-te a una que ja existeixi.</p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2 rounded-full bg-line/60 p-1">
        {(["crear", "unir"] as const).map((m) => (
          <button
            key={m}
            className={`rounded-full py-2 text-sm font-semibold transition ${mode === m ? "bg-card shadow-sm" : "text-muted"}`}
            onClick={() => setMode(m)}
          >
            {m === "crear" ? "Crear una llar" : "Tinc un codi"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="card space-y-4 p-5">
        {mode === "crear" ? (
          <div>
            <label className="label" htmlFor="nom-llar">
              Nom de la llar
            </label>
            <input id="nom-llar" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="codi">
              Codi d'invitació
            </label>
            <input
              id="codi"
              className="input font-mono uppercase tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="A1B2C3D4"
              required
              autoCapitalize="characters"
            />
            <p className="mt-1.5 text-xs text-muted">El trobaràs a Ajustos, al mòbil de qui ja fa servir l'app.</p>
          </div>
        )}
        <div>
          <label className="label" htmlFor="nom-meu">
            Com et diuen a casa?
          </label>
          <input id="nom-meu" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
        </div>
        {error && <p className="rounded-xl bg-tomato-soft p-3 text-sm text-tomato">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Un moment…" : mode === "crear" ? "Crear i començar" : "Unir-me"}
        </button>
      </form>
    </main>
  );
}
