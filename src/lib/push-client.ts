import { supabaseBrowser } from "./supabase/client";
import type { PushEvent, PushKind } from "./push-messages";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type PushPrefs = Record<PushKind, boolean>;
export const DEFAULT_PUSH_PREFS: PushPrefs = { llista: true, propostes: true, respostes: true };

/** El servidor té les claus d'avisos configurades? */
export const pushConfigured = VAPID_PUBLIC.length > 20;

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
}

/** Subscripció d'aquest mòbil (si n'hi ha) i les seves preferències */
export async function currentPush(): Promise<{ endpoint: string; prefs: PushPrefs } | null> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  const { data } = await supabaseBrowser().from("push_subscriptions").select("prefs").eq("endpoint", sub.endpoint).maybeSingle();
  if (!data) return null;
  return { endpoint: sub.endpoint, prefs: { ...DEFAULT_PUSH_PREFS, ...((data as { prefs: Partial<PushPrefs> }).prefs ?? {}) } };
}

/** Demana permís i desa aquest mòbil per rebre avisos. Torna un missatge d'error o null. */
export async function enablePush(householdId: string, prefs: PushPrefs = DEFAULT_PUSH_PREFS): Promise<string | null> {
  if (!pushSupported()) return "Aquest navegador no pot rebre avisos. A l'iPhone, cal instal·lar l'app a la pantalla d'inici.";
  if (!pushConfigured) return "Falta configurar les claus d'avisos a Vercel";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "El navegador no ha donat permís per als avisos";
  const reg = await registration();
  if (!reg) return "No s'ha pogut preparar el servei d'avisos";
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabaseBrowser()
    .from("push_subscriptions")
    .upsert({ household_id: householdId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, prefs }, { onConflict: "endpoint" });
  if (error) return /relation|schema cache|does not exist/i.test(error.message) ? "Cal executar la migració 0008 a Supabase" : error.message;
  return null;
}

export async function updatePushPrefs(endpoint: string, prefs: PushPrefs): Promise<string | null> {
  const { error } = await supabaseBrowser().from("push_subscriptions").update({ prefs }).eq("endpoint", endpoint);
  return error ? error.message : null;
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabaseBrowser().from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}

/** Avisa la resta de la família (sense esperar ni mostrar errors: és un extra) */
export function notifyFamily(householdId: string, event: PushEvent) {
  if (!pushConfigured || typeof window === "undefined") return;
  fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ householdId, event }),
    keepalive: true,
  }).catch(() => {});
}

// Els productes que s'afegeixen d'un en un a la llista s'agrupen en un sol avís
let listBuffer: { householdId: string; items: string[] } | null = null;
let listTimer: ReturnType<typeof setTimeout> | null = null;

function flushListNotice() {
  if (listTimer) clearTimeout(listTimer);
  listTimer = null;
  if (listBuffer?.items.length) notifyFamily(listBuffer.householdId, { type: "llista", items: listBuffer.items });
  listBuffer = null;
}

export function noticeListAdded(householdId: string, names: string[]) {
  if (!pushConfigured || !names.length) return;
  if (listBuffer && listBuffer.householdId !== householdId) flushListNotice();
  listBuffer = { householdId, items: [...(listBuffer?.items ?? []), ...names] };
  if (listTimer) clearTimeout(listTimer);
  listTimer = setTimeout(flushListNotice, 20000);
  if (typeof window !== "undefined") window.addEventListener("pagehide", flushListNotice, { once: true });
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/**
 * Si s'han canviat les claus d'avisos a Vercel, les subscripcions antigues ja
 * no funcionen: aquest mòbil es torna a subscriure sol amb la clau nova i
 * conserva les preferències.
 */
export async function refreshPushKey(householdId: string): Promise<void> {
  if (!pushSupported() || !pushConfigured || Notification.permission !== "granted") return;
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (!reg || !sub) return;
  const key = urlBase64ToUint8Array(VAPID_PUBLIC);
  if (sameKey(sub.options.applicationServerKey, key)) return;
  const supabase = supabaseBrowser();
  const { data } = await supabase.from("push_subscriptions").select("prefs").eq("endpoint", sub.endpoint).maybeSingle();
  if (!data) return; // aquest mòbil no tenia els avisos activats a l'app
  const prefs = { ...DEFAULT_PUSH_PREFS, ...((data as { prefs: Partial<PushPrefs> }).prefs ?? {}) };
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe().catch(() => {});
  await enablePush(householdId, prefs);
}
