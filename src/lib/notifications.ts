import { expiryLabel } from "./dates";
import type { PantryItem } from "./types";

const PREF_KEY = "cuina-casa:avisos";
const LAST_KEY = "cuina-casa:avisos-ultim";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export function notificationsEnabled(): boolean {
  if (!notificationsSupported()) return false;
  try {
    return Notification.permission === "granted" && localStorage.getItem(PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const perm = await Notification.requestPermission();
  try {
    localStorage.setItem(PREF_KEY, perm === "granted" ? "1" : "0");
  } catch {}
  return perm === "granted";
}

export function disableNotifications() {
  try {
    localStorage.setItem(PREF_KEY, "0");
  } catch {}
}

/**
 * Mostra, com a molt un cop al dia, una notificació del sistema amb els
 * productes que caduquen aviat. S'executa en obrir l'app.
 */
export async function notifyExpiring(items: PantryItem[]) {
  if (!notificationsEnabled() || items.length === 0) return;
  const today = new Date().toDateString();
  try {
    if (localStorage.getItem(LAST_KEY) === today) return;
    localStorage.setItem(LAST_KEY, today);
  } catch {
    return;
  }
  const body = items
    .slice(0, 4)
    .map((i) => `${i.name}: ${expiryLabel(i.expires_on).toLowerCase()}`)
    .join("\n");
  const title = items.length === 1 ? "1 producte caduca aviat" : `${items.length} productes caduquen aviat`;
  const options: NotificationOptions = { body, icon: "/icons/icon-192.png", badge: "/icons/badge.png", tag: "caducitats", data: { url: "/rebost" } };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    // Alguns navegadors no permeten notificacions des d'aquí
  }
}
