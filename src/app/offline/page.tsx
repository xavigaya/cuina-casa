export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6 text-center">
      <div className="mb-3 text-5xl" aria-hidden>
        📶
      </div>
      <h1 className="text-3xl font-semibold">Sense connexió</h1>
      <p className="mt-3 text-muted">No hi ha internet ara mateix. Quan tornis a tenir cobertura, l'app s'actualitzarà sola.</p>
      <a href="/" className="btn-primary mx-auto mt-8">
        Torna-ho a provar
      </a>
    </main>
  );
}
