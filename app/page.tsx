export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-20">
      <section className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-10 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-600">
          Coming Soon
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl">
          Storm Lake Pack and Ship
        </h1>
        <p className="mt-5 text-lg text-zinc-700">
          We’re preparing to open our doors in Storm Lake.
        </p>
        <div className="mx-auto mt-8 max-w-md rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-5">
          <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Location
          </p>
          <p className="mt-2 text-base font-semibold text-zinc-900">
            107 E Railroad
            <br />
            Storm Lake, Iowa 50588
          </p>
        </div>
      </section>
    </main>
  );
}
