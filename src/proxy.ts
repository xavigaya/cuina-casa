import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPrivateVercelHost } from "@/lib/site-url";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/manifest.webmanifest", "/sw.js", "/offline", "/api/keepalive"];

/**
 * S'executa abans de cada pàgina: refresca la sessió de Supabase i
 * envia a /login qui no hagi iniciat sessió.
 */
export async function proxy(request: NextRequest) {
  // Des d'una adreça privada de Vercel, tot es redirigeix a l'adreça pública (mateix camí).
  // Així, si Supabase torna de l'inici de sessió a l'adreça antiga, el codi arriba igualment
  // a l'adreça on s'ha començat a entrar i la sessió s'obre bé.
  const host = request.headers.get("host") ?? request.nextUrl.hostname;
  const publicUrl = publicOrigin();
  if (publicUrl && isPrivateVercelHost(host.split(":")[0]) && new URL(publicUrl).host !== host) {
    return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, publicUrl), 307);
  }

  // Sense configuració no es pot comprovar la sessió: deixem passar i la pàgina ho explica
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!user && !isPublic && !path.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (!user && !isPublic && path.startsWith("/api/")) {
    return NextResponse.json({ error: "Cal iniciar sessió" }, { status: 401 });
  }
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};

/** Adreça pública al servidor (variable pròpia o domini de producció de Vercel). */
function publicOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  return production ? `https://${production}` : null;
}
