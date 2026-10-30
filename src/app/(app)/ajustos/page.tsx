"use client";

import { useEffect, useState } from "react";
import { Bell, Copy, LogOut, RefreshCw, Share2, Smartphone } from "lucide-react";
import { useHousehold } from "@/components/household";
import { PageHeader, toast } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { disableNotifications, enableNotifications, notificationsEnabled, notificationsSupported } from "@/lib/notifications";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export default function SettingsPage() {
  const supabase = supabaseBrowser();
  const { household, members, user, refresh } = useHousehold();
  const [name, setName] = useState(household.name);
  const [servings, setServings] = useState(household.servings);
  const [warnDays, setWarnDays] = useState(household.expiry_warning_days);
  const [code, setCode] = useState(household.invite_code);
  const [notif, setNotif] = useState(false);
  const [notifSupported, setNotifSupported] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const me = members.find((m) => m.user_id === user.id);
  const [myName, setMyName] = useState(me?.display_name ?? "");

  useEffect(() => {
    setNotif(notificationsEnabled());
    setNotifSupported(notificationsSupported());
    setStandalone(window.matchMedia("(display-mode: standalone)").matches);
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function saveHousehold(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase
      .from("households")
      .update({ name: name.trim() || household.name, servings, expiry_warning_days: warnDays })
      .eq("id", household.id);
    if (!error && myName.trim() !== (me?.display_name ?? "")) {
      await supabase.from("household_members").update({ display_name: myName.trim() || null }).eq("household_id", household.id).eq("user_id", user.id);
    }
    toast(error ? "No s'ha pogut desar" : "Desat");
    refresh();
  }

  async function share() {
    const text = `Uneix-te a "${household.name}" a Cuina Casa amb el codi ${code}: ${window.location.origin}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Cuina Casa", text });
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(text);
    toast("Invitació copiada");
  }

  async function regenerate() {
    if (!confirm("El codi actual deixarà de funcionar. Vols crear-ne un de nou?")) return;
    const { data, error } = await supabase.rpc("regenerate_invite_code", { p_household: household.id });
    if (!error && data) setCode(data as string);
  }

  async function toggleNotifications() {
    if (notif) {
      disableNotifications();
      setNotif(false);
    } else {
      const ok = await enableNotifications();
      setNotif(ok);
      toast(ok ? "Avisos activats" : "El navegador no ha donat permís");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <>
      <PageHeader title="Ajustos" />

      <div className="space-y-6">
        <form onSubmit={saveHousehold} className="card space-y-4 p-5">
          <h2 className="text-lg font-semibold">La llar</h2>
          <div>
            <label className="label" htmlFor="a-nom">
              Nom de la llar
            </label>
            <input id="a-nom" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div>
            <label className="label" htmlFor="a-jo">
              El teu nom
            </label>
            <input id="a-jo" className="input" value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={40} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="a-rac">
                Persones a taula
              </label>
              <input id="a-rac" className="input" type="number" min={1} max={20} value={servings} onChange={(e) => setServings(Math.min(20, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
            <div>
              <label className="label" htmlFor="a-cad">
                Avisa'm de caducitats (dies abans)
              </label>
              <input id="a-cad" className="input" type="number" min={0} max={30} value={warnDays} onChange={(e) => setWarnDays(Math.min(30, Math.max(0, Number(e.target.value) || 0)))} />
            </div>
          </div>
          <button className="btn-primary w-full">Desa</button>
        </form>

        <section className="card space-y-4 p-5">
          <h2 className="text-lg font-semibold">Família</h2>
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-herb-soft font-bold text-herb">
                  {(m.display_name ?? "?").charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 font-medium">
                  {m.display_name ?? "Sense nom"}
                  {m.user_id === user.id && <span className="ml-1 text-sm font-normal text-muted">(tu)</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="rounded-2xl bg-paper p-4 text-center">
            <p className="text-sm text-muted">Codi per convidar algú de casa</p>
            <p className="my-2 font-mono text-3xl font-bold tracking-[0.25em]">{code}</p>
            <div className="flex justify-center gap-2">
              <button className="btn-primary" onClick={share}>
                <Share2 className="size-4" /> Comparteix
              </button>
              <button
                className="btn-secondary !px-3"
                onClick={async () => {
                  await navigator.clipboard.writeText(code);
                  toast("Codi copiat");
                }}
                aria-label="Copia el codi"
              >
                <Copy className="size-4" />
              </button>
              <button className="btn-secondary !px-3" onClick={regenerate} aria-label="Canvia el codi">
                <RefreshCw className="size-4" />
              </button>
            </div>
          </div>
          <p className="text-xs text-muted">Cada persona entra amb el seu compte de Google i, la primera vegada, escriu aquest codi.</p>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="text-lg font-semibold">Al mòbil</h2>
          {notifSupported && (
            <div className="flex items-center gap-3">
              <Bell className="size-5 text-muted" />
              <div className="flex-1">
                <p className="font-medium">Avisos de caducitat</p>
                <p className="text-xs text-muted">Una notificació al dia quan obris l'app, si hi ha productes a punt de caducar.</p>
              </div>
              <button
                role="switch"
                aria-checked={notif}
                onClick={toggleNotifications}
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${notif ? "bg-herb" : "bg-line"}`}
              >
                <span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${notif ? "left-[1.375rem]" : "left-0.5"}`} />
              </button>
            </div>
          )}
          <div className="flex items-start gap-3">
            <Smartphone className="mt-0.5 size-5 text-muted" />
            <div className="flex-1">
              <p className="font-medium">Instal·la l'app</p>
              {standalone ? (
                <p className="text-sm text-muted">Ja la tens instal·lada. 👍</p>
              ) : installEvent ? (
                <button
                  className="btn-secondary mt-2"
                  onClick={async () => {
                    await installEvent.prompt();
                    setInstallEvent(null);
                  }}
                >
                  Instal·la a la pantalla d'inici
                </button>
              ) : isIOS ? (
                <p className="text-sm text-muted">A Safari, prem el botó Compartir i tria «Afegeix a la pantalla d'inici».</p>
              ) : (
                <p className="text-sm text-muted">Al menú del navegador, tria «Instal·la l'aplicació» o «Afegeix a la pantalla d'inici».</p>
              )}
            </div>
          </div>
        </section>

        <section className="card p-5">
          <p className="mb-3 text-sm text-muted">Has entrat com a {user.email}</p>
          <button className="btn-secondary w-full" onClick={signOut}>
            <LogOut className="size-4" /> Tanca la sessió
          </button>
        </section>
      </div>
    </>
  );
}
