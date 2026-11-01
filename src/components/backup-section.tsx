"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ImageOff, Upload } from "lucide-react";
import { useHousehold, usePermissions } from "./household";
import { Sheet, Spinner, toast } from "./ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PHOTO_BUCKET } from "@/lib/photo-upload-constants";
import {
  PART_LABEL,
  backupCounts,
  backupFileName,
  makeBackup,
  orphanPhotos,
  parseBackup,
  planImport,
  type Backup,
  type BackupPart,
  type ExistingData,
} from "@/lib/backup";

const LAST_BACKUP_KEY = (h: string) => `cuina-casa:ultima-copia:${h}`;
const LAST_CLEAN_KEY = (h: string) => `cuina-casa:ultima-neteja-fotos:${h}`;
type Supa = ReturnType<typeof supabaseBrowser>;

async function rows<T = Record<string, unknown>>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  return error ? [] : ((data as T[]) ?? []); // taules d'una migració que encara no s'ha executat: buides
}

async function collect(supabase: Supa, householdId: string) {
  const eq = <T = Record<string, unknown>,>(table: string, select = "*") => rows<T>(supabase.from(table).select(select).eq("household_id", householdId));
  const [recipes, meal_plan, menu_templates, pantry_items, shopping_items, foods, product_prices, stores] = await Promise.all([
    eq<Backup["recipes"][number]>("recipes", "*, recipe_ingredients!recipe_ingredients_recipe_id_fkey(*)"),
    eq("meal_plan"),
    eq("menu_templates"),
    eq("pantry_items"),
    eq("shopping_items"),
    eq("foods"),
    eq("product_prices"),
    eq("stores"),
  ]);
  return { recipes, meal_plan, menu_templates, pantry_items, shopping_items, foods, product_prices, stores };
}

/** Busca les fotos de la llar que ja no fa servir ningú */
async function findOrphans(supabase: Supa, householdId: string) {
  const storage = supabase.storage.from(PHOTO_BUCKET);
  const files: { path: string; created_at: string | null; size?: number }[] = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const { data, error } = await storage.list(householdId, { limit: 1000, offset });
    if (error) throw error;
    for (const f of data ?? []) {
      if (!f.id) continue; // carpetes
      files.push({ path: `${householdId}/${f.name}`, created_at: f.created_at ?? null, size: Number((f.metadata as { size?: number } | null)?.size ?? 0) });
    }
    if (!data || data.length < 1000) break;
  }
  const [recipes, log] = await Promise.all([
    rows<{ image_url: string | null }>(supabase.from("recipes").select("image_url").eq("household_id", householdId).not("image_url", "is", null)),
    rows<{ old_data: unknown; new_data: unknown }>(supabase.from("activity_log").select("old_data, new_data").eq("household_id", householdId).eq("table_name", "recipes")),
  ]);
  return orphanPhotos(files, recipes.map((r) => r.image_url!).filter(Boolean), JSON.stringify(log), PHOTO_BUCKET);
}

const kb = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`);

export function BackupSection() {
  const supabase = supabaseBrowser();
  const { household } = useHousehold();
  const { privileged } = usePermissions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ backup: Backup; parts: Set<BackupPart> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [orphans, setOrphans] = useState<{ path: string; size: number }[] | null>(null);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    try {
      setLastBackup(localStorage.getItem(LAST_BACKUP_KEY(household.id)));
    } catch {}
  }, [household.id]);

  // Una vegada per setmana, un privilegiat neteja sol les fotos òrfenes
  useEffect(() => {
    if (!privileged) return;
    let last = 0;
    try {
      last = Number(localStorage.getItem(LAST_CLEAN_KEY(household.id)) ?? 0);
    } catch {}
    if (Date.now() - last < 7 * 86400000) return;
    findOrphans(supabase, household.id)
      .then(async (list) => {
        if (list.length) await supabase.storage.from(PHOTO_BUCKET).remove(list.map((o) => o.path));
        try {
          localStorage.setItem(LAST_CLEAN_KEY(household.id), String(Date.now()));
        } catch {}
      })
      .catch(() => {});
  }, [privileged, supabase, household.id]);

  async function exportAll() {
    setExporting(true);
    try {
      const data = await collect(supabase, household.id);
      const backup = makeBackup({
        household: { name: household.name, servings: household.servings, expiry_warning_days: household.expiry_warning_days },
        ...data,
      });
      const blob = new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backupFileName(household.name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      const now = new Date().toISOString();
      setLastBackup(now);
      try {
        localStorage.setItem(LAST_BACKUP_KEY(household.id), now);
      } catch {}
      toast(`Còpia descarregada (${data.recipes.length} receptes)`);
    } catch {
      toast("No s'ha pogut fer la còpia");
    }
    setExporting(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const parsed = parseBackup(await file.text());
    if (typeof parsed === "string") {
      toast(parsed);
      return;
    }
    const counts = backupCounts(parsed);
    // Per defecte, el que es guarda de debò; la llista i el rebost, desmarcats
    const parts = new Set<BackupPart>((["receptes", "plantilles", "aliments", "preus", "supers", "menu"] as BackupPart[]).filter((p) => counts[p] > 0));
    setImporting({ backup: parsed, parts });
  }

  async function runImport() {
    if (!importing) return;
    setBusy(true);
    try {
      const current = await collect(supabase, household.id);
      const existing: ExistingData = {
        recipes: current.recipes.map((r) => ({ id: String(r.id), title: String(r.title) })),
        meal_plan: current.meal_plan as unknown as ExistingData["meal_plan"],
        menu_templates: current.menu_templates as unknown as ExistingData["menu_templates"],
        pantry_items: current.pantry_items as unknown as ExistingData["pantry_items"],
        shopping_items: current.shopping_items as unknown as ExistingData["shopping_items"],
        foods: current.foods as unknown as ExistingData["foods"],
        product_prices: current.product_prices as unknown as ExistingData["product_prices"],
        stores: current.stores as unknown as ExistingData["stores"],
      };
      const plan = planImport(importing.backup, existing, importing.parts, household.id);
      // Per ordre: les receptes abans que els ingredients i el menú que les fa servir
      const order: (keyof Omit<typeof plan, "skipped">)[] = [
        "recipes",
        "recipe_ingredients",
        "meal_plan",
        "menu_templates",
        "pantry_items",
        "shopping_items",
        "foods",
        "product_prices",
        "stores",
      ];
      let added = 0;
      const failed: string[] = [];
      for (const table of order) {
        const list = plan[table];
        for (let i = 0; i < list.length; i += 300) {
          const { error } = await supabase.from(table).insert(list.slice(i, i + 300));
          if (error) {
            failed.push(table);
            break;
          }
          if (table !== "recipe_ingredients") added += list.slice(i, i + 300).length;
        }
      }
      setImporting(null);
      toast(
        failed.length
          ? `Importació incompleta (${added} elements). Pot faltar alguna migració a Supabase.`
          : `Importat: ${added} elements${plan.skipped ? ` · ${plan.skipped} ja hi eren` : ""}`,
      );
    } catch (e) {
      toast(`No s'ha pogut importar: ${(e as Error).message}`);
    }
    setBusy(false);
  }

  async function scanPhotos() {
    setCleaning(true);
    try {
      setOrphans(await findOrphans(supabase, household.id));
    } catch {
      toast("No s'han pogut revisar les fotos (cal la migració 0004)");
    }
    setCleaning(false);
  }

  async function cleanPhotos() {
    if (!orphans?.length) return;
    setCleaning(true);
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove(orphans.map((o) => o.path));
    setCleaning(false);
    if (error) return toast("No s'han pogut esborrar les fotos");
    toast(`${orphans.length} fotos esborrades`);
    setOrphans([]);
    try {
      localStorage.setItem(LAST_CLEAN_KEY(household.id), String(Date.now()));
    } catch {}
  }

  const daysSince = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup)) / 86400000) : null;
  const counts = importing ? backupCounts(importing.backup) : null;

  return (
    <section className="card space-y-4 p-5">
      <h2 className="text-lg font-semibold">Dades i còpies</h2>

      <div className="flex items-start gap-3">
        <Download className="mt-0.5 size-5 text-muted" />
        <div className="flex-1">
          <p className="font-medium">Còpia de seguretat</p>
          <p className="text-sm text-muted">
            Descarrega un fitxer amb les receptes, el menú, les plantilles, el rebost, la llista, els aliments, els preus i els supermercats.
            {daysSince == null
              ? " Encara no n'has fet cap des d'aquest dispositiu."
              : daysSince === 0
                ? " L'última, avui."
                : ` L'última, fa ${daysSince} ${daysSince === 1 ? "dia" : "dies"}.`}
          </p>
          {daysSince != null && daysSince > 30 && <p className="mt-1 text-xs font-semibold text-saffron">Fa més d'un mes: va bé fer-ne una de nova.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={exportAll} disabled={exporting}>
              {exporting ? <Spinner className="!size-4 !border-white/40 !border-t-white" /> : <Download className="size-4" />} Descarrega la còpia
            </button>
            {privileged && (
              <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> Importa
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {privileged && (
        <div className="flex items-start gap-3">
          <ImageOff className="mt-0.5 size-5 text-muted" />
          <div className="flex-1">
            <p className="font-medium">Fotos que ja no es fan servir</p>
            <p className="text-sm text-muted">
              Quan s&apos;esborra una recepta o se&apos;n canvia la foto, la foto es guarda 90 dies per si es vol desfer. Després s&apos;esborra sola (una
              revisió per setmana).
            </p>
            {orphans === null ? (
              <button className="btn-secondary mt-2" onClick={scanPhotos} disabled={cleaning}>
                {cleaning ? <Spinner className="!size-4" /> : null} Revisa-les ara
              </button>
            ) : orphans.length === 0 ? (
              <p className="mt-2 text-sm font-semibold text-herb">No n&apos;hi ha cap per esborrar.</p>
            ) : (
              <button className="btn-secondary mt-2 !text-tomato" onClick={cleanPhotos} disabled={cleaning}>
                {cleaning ? <Spinner className="!size-4" /> : null} Esborra&apos;n {orphans.length} ({kb(orphans.reduce((n, o) => n + o.size, 0))})
              </button>
            )}
          </div>
        </div>
      )}

      <Sheet open={!!importing} onClose={() => setImporting(null)} title="Importa una còpia">
        {importing && counts && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Còpia de «{importing.backup.household.name}»
              {importing.backup.exported_at ? ` del ${new Date(importing.backup.exported_at).toLocaleDateString("ca")}` : ""}. S&apos;afegeix al que ja hi ha:
              el que ja existeix (receptes amb el mateix nom, plats del mateix dia…) no es duplica i res no s&apos;esborra.
            </p>
            <ul className="space-y-2">
              {(Object.keys(PART_LABEL) as BackupPart[])
                .filter((p) => counts[p] > 0)
                .map((p) => (
                  <li key={p}>
                    <label className="flex items-center gap-3 rounded-xl bg-card px-3 py-2 ring-1 ring-line">
                      <input
                        type="checkbox"
                        className="size-5 accent-[var(--color-herb)]"
                        checked={importing.parts.has(p)}
                        onChange={(e) => {
                          const parts = new Set(importing.parts);
                          if (e.target.checked) parts.add(p);
                          else parts.delete(p);
                          setImporting({ ...importing, parts });
                        }}
                      />
                      <span className="flex-1 font-medium">{PART_LABEL[p]}</span>
                      <span className="text-sm text-muted">{counts[p]}</span>
                    </label>
                  </li>
                ))}
            </ul>
            <p className="text-xs text-muted">Les fotos no van dins del fitxer: les receptes en conserven l&apos;enllaç.</p>
            <button className="btn-primary w-full" onClick={runImport} disabled={busy || importing.parts.size === 0}>
              {busy ? <Spinner className="!size-4 !border-white/40 !border-t-white" /> : <Upload className="size-4" />} Importa
            </button>
          </div>
        )}
      </Sheet>
    </section>
  );
}
