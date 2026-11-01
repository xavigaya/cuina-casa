import { NextResponse } from "next/server";
import webpush from "web-push";
import { requireMember } from "@/lib/api-auth";
import { buildPushMessage, parsePushEvent } from "@/lib/push-messages";

export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * Envia un avís al mòbil a la resta de la família.
 * Les claus VAPID són variables d'entorn de Vercel (mai al codi):
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY i, opcional, VAPID_SUBJECT.
 */
export async function POST(request: Request) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return NextResponse.json({ sent: 0, configured: false });

  const access = await requireMember();
  if (access instanceof NextResponse) return access;
  const { supabase } = access;

  let householdId = "";
  let event = null;
  try {
    const body = await request.json();
    householdId = String(body.householdId ?? "");
    event = parsePushEvent(body.event);
  } catch {}
  if (!/^[0-9a-f-]{36}$/i.test(householdId) || !event) return NextResponse.json({ error: "Petició no vàlida" }, { status: 400 });

  // La base de dades comprova que qui envia és de la llar i tria els destinataris
  const preview = buildPushMessage(event, "");
  const { data: targets, error } = await supabase.rpc("push_targets", {
    p_household: householdId,
    p_kind: preview.kind,
    p_user: preview.to ?? null,
  });
  if (error) return NextResponse.json({ sent: 0, error: "Sense destinataris" });
  const rows = (targets as { endpoint: string; p256dh: string; auth: string; sender_name: string }[] | null) ?? [];
  if (!rows.length) return NextResponse.json({ sent: 0 });

  const message = buildPushMessage(event, rows[0].sender_name);
  const payload = JSON.stringify({ title: message.title, body: message.body, url: message.url, tag: message.tag });
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:avisos@cuina-casa.app", publicKey, privateKey);

  let sent = 0;
  await Promise.all(
    rows.map(async (t) => {
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, { TTL: 12 * 3600, urgency: "normal", topic: message.tag.slice(0, 32) });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // El mòbil ja no accepta avisos (s'ha desinstal·lat o s'ha tret el permís)
        if (status === 404 || status === 410) await supabase.rpc("drop_push_endpoint", { p_household: householdId, p_endpoint: t.endpoint });
      }
    }),
  );
  return NextResponse.json({ sent });
}
