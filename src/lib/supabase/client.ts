"use client";

import { createBrowserClient } from "@supabase/ssr";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Indica si les variables de Supabase s'han configurat (a Vercel o a .env.local). */
export const supabaseConfigured = Boolean(URL && KEY);

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Client de Supabase per al navegador (una sola instància). */
export function supabaseBrowser() {
  if (!client) {
    if (!supabaseConfigured) {
      throw new Error("Falten les variables NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    client = createBrowserClient(URL!, KEY!);
  }
  return client;
}
