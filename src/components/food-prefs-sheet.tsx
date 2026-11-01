"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useHousehold } from "./household";
import { Sheet, Spinner, toast } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ALLERGENS, allergenInfo, parseList } from "@/lib/diet";
import type { Member } from "@/lib/types";

/** Resum curt per a la llista de la família */
export function foodPrefsSummary(m: Member): string | null {
  const a = (m.allergies ?? []).map((x) => allergenInfo(x)?.label.toLowerCase() ?? x);
  const v = m.avoid ?? [];
  const parts = [a.length ? `Al·lèrgia: ${a.join(", ")}` : null, v.length ? `No menja: ${v.join(", ")}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Al·lèrgies i el que no menja una persona de casa */
export function FoodPrefsSheet({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const supabase = supabaseBrowser();
  const { household, user, refresh } = useHousehold();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [otherAllergies, setOtherAllergies] = useState("");
  const [avoid, setAvoid] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!member) return;
    const known = (member.allergies ?? []).filter((a) => allergenInfo(a));
    setSelected(new Set(known));
    setOtherAllergies((member.allergies ?? []).filter((a) => !allergenInfo(a)).join(", "));
    setAvoid((member.avoid ?? []).join(", "));
  }, [member]);

  async function save() {
    if (!member) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_member_food_prefs", {
      p_household: household.id,
      p_user: member.user_id,
      p_allergies: [...selected, ...parseList(otherAllergies)],
      p_avoid: parseList(avoid),
    });
    setBusy(false);
    if (error) {
      toast(/function|schema cache/i.test(error.message) ? "Cal executar la migració 0008 a Supabase" : error.message);
      return;
    }
    toast("Preferències desades");
    onClose();
    refresh();
  }

  const who = member?.user_id === user.id ? "teves" : `de ${member?.display_name ?? "aquesta persona"}`;

  return (
    <Sheet open={!!member} onClose={onClose} title={`Preferències ${who}`}>
      {member && (
        <div className="space-y-5">
          <div>
            <p className="label">Al·lèrgies i intoleràncies</p>
            <div className="flex flex-wrap gap-2">
              {ALLERGENS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="chip"
                  data-active={selected.has(a.id)}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(a.id)) next.delete(a.id);
                      else next.add(a.id);
                      return next;
                    })
                  }
                >
                  {a.emoji} {a.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="altres-alergies">
              Altres al·lèrgies (ingredients concrets)
            </label>
            <input id="altres-alergies" className="input" value={otherAllergies} onChange={(e) => setOtherAllergies(e.target.value)} placeholder="kiwi, préssec…" />
          </div>
          <div>
            <label className="label" htmlFor="no-menja">
              No menja o no li agrada
            </label>
            <input id="no-menja" className="input" value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="ceba, coriandre, fetge…" />
            <p className="mt-1 text-xs text-muted">Separa-ho amb comes. Les receptes i el menú avisaran quan en portin.</p>
          </div>
          <button className="btn-primary w-full" onClick={save} disabled={busy}>
            {busy ? <Spinner className="!size-4 !border-white/40 !border-t-white" /> : <Check className="size-4" />} Desa
          </button>
        </div>
      )}
    </Sheet>
  );
}
