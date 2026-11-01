import { NextResponse } from "next/server";
import { supabaseServer } from "./supabase/server";

type Supa = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * Les rutes del servidor només les poden fer servir els membres d'una llar
 * (no n'hi ha prou amb tenir un compte de Google). Si es passa `householdId`,
 * cal ser membre d'aquella llar en concret.
 */
export async function requireMember(householdId?: string): Promise<{ supabase: Supa; userId: string } | NextResponse> {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Cal iniciar sessió" }, { status: 401 });
  let q = supabase.from("household_members").select("household_id").eq("user_id", auth.user.id);
  if (householdId) q = q.eq("household_id", householdId);
  const { data, error } = await q.limit(1);
  if (error || !data?.length) return NextResponse.json({ error: "Cal ser membre d'una llar" }, { status: 403 });
  return { supabase, userId: auth.user.id };
}
