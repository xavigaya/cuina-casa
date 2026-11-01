import { supabaseBrowser } from "./supabase/client";

/**
 * Desfà l'última acció registrada sobre un element (per als botons «Desfés»
 * dels avisos). Retorna un missatge d'error o null si tot ha anat bé.
 */
export async function undoLatest(table: string, rowId: string): Promise<string | null> {
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from("activity_log")
    .select("id")
    .eq("table_name", table)
    .eq("row_id", rowId)
    .is("undone_at", null)
    .order("id", { ascending: false })
    .limit(1);
  if (error) return "Cal executar la migració 0005 a Supabase per poder desfer";
  const id = (data as { id: number }[] | null)?.[0]?.id;
  if (!id) return "No hi ha res per desfer";
  const res = await supabase.rpc("undo_actions", { p_ids: [id] });
  return res.error ? res.error.message : null;
}

export async function setStatus(table: "recipes" | "meal_plan", ids: string[], status: "aprovada" | "proposta"): Promise<string | null> {
  if (!ids.length) return null;
  const { error } = await supabaseBrowser().from(table).update({ status }).in("id", ids);
  return error ? error.message : null;
}

/** Recupera files esborrades fent servir el registre (conserven l'id i l'autor). */
export async function undoDeletes(table: string, rowIds: string[]): Promise<string | null> {
  if (!rowIds.length) return null;
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from("activity_log")
    .select("id")
    .eq("table_name", table)
    .eq("action", "delete")
    .in("row_id", rowIds)
    .is("undone_at", null);
  if (error) return error.message;
  const ids = ((data as { id: number }[] | null) ?? []).map((d) => d.id);
  if (!ids.length) return "No hi ha res per desfer";
  const res = await supabase.rpc("undo_actions", { p_ids: ids });
  return res.error ? res.error.message : null;
}

/**
 * Desfà l'última acció de cada un d'aquests elements (p. ex. tots els
 * productes del rebost que ha canviat «L'he cuinada»).
 */
export async function undoLatestFor(table: string, rowIds: string[]): Promise<string | null> {
  if (!rowIds.length) return null;
  const supabase = supabaseBrowser();
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, row_id")
    .eq("table_name", table)
    .in("row_id", rowIds)
    .is("undone_at", null)
    .order("id", { ascending: false });
  if (error) return "Cal executar la migració 0005 a Supabase per poder desfer";
  const seen = new Set<string>();
  const ids: number[] = [];
  for (const row of (data as { id: number; row_id: string }[] | null) ?? []) {
    if (seen.has(row.row_id)) continue;
    seen.add(row.row_id);
    ids.push(row.id);
  }
  if (!ids.length) return "No hi ha res per desfer";
  const res = await supabase.rpc("undo_actions", { p_ids: ids });
  return res.error ? res.error.message : null;
}
