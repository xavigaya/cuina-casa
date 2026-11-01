export function ConfigMissing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-6 text-center">
      <div className="mb-3 text-5xl" aria-hidden>
        🔧
      </div>
      <h1 className="text-2xl font-semibold">Falta connectar Supabase</h1>
      <p className="mt-3 text-muted">
        A Vercel, ves a <strong>Settings → Environment Variables</strong> i afegeix{" "}
        <code className="font-mono text-sm">NEXT_PUBLIC_SUPABASE_URL</code> i{" "}
        <code className="font-mono text-sm">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. Després, a{" "}
        <strong>Deployments</strong>, torna a publicar l'últim desplegament (<em>Redeploy</em>).
      </p>
    </main>
  );
}
