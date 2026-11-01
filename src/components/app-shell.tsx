"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, Home, Package, Settings, ShoppingCart } from "lucide-react";
import type { ReactNode } from "react";
import { useHousehold } from "./household";
import { Toaster } from "./ui";
import { PublicUrlBanner } from "./public-url-banner";

const NAV = [
  { href: "/", label: "Inici", icon: Home },
  { href: "/llista", label: "Llista", icon: ShoppingCart },
  { href: "/rebost", label: "Rebost", icon: Package },
  { href: "/receptes", label: "Receptes", icon: BookOpen },
  { href: "/menu", label: "Menú", icon: CalendarDays },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { household } = useHousehold();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="lg:flex">
      {/* Barra lateral (ordinador) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line p-5 lg:flex">
        <div className="mb-8 flex items-center gap-2">
          <span className="text-2xl" aria-hidden>
            🍲
          </span>
          <div>
            <p className="font-display text-xl font-semibold leading-none">Cuina Casa</p>
            <p className="mt-1 text-xs text-muted">{household.name}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {[...NAV, { href: "/ajustos", label: "Ajustos", icon: Settings }].map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium transition ${
                isActive(href) ? "bg-card text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"
              }`}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Capçalera (mòbil) */}
        <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)] lg:hidden">
          <p className="text-sm font-semibold text-muted">{household.name}</p>
          <Link href="/ajustos" aria-label="Ajustos" className="-mr-2 rounded-full p-2 text-muted">
            <Settings className="size-5" />
          </Link>
        </div>

        <PublicUrlBanner />
        <main className="mx-auto max-w-3xl px-4 pb-32 pt-3 lg:px-8 lg:pb-12 lg:pt-10">{children}</main>
      </div>

      {/* Barra inferior (mòbil) */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${
                isActive(href) ? "text-tomato" : "text-muted"
              }`}
            >
              <Icon className="size-[22px]" strokeWidth={isActive(href) ? 2.4 : 1.8} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
      <Toaster />
    </div>
  );
}
