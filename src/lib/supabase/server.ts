import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Client de Supabase per al servidor (rutes i components de servidor). */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Des d'un component de servidor no es poden escriure galetes; el proxy ja ho fa.
          }
        },
      },
    },
  );
}
