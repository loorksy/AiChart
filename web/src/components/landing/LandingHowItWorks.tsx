import { LANDING } from "@/components/landing/landingContent";

export function LandingHowItWorks() {
  return (
    <section id="how" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="mb-10 text-center text-2xl font-bold sm:text-3xl">
          {LANDING.how.title}
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {LANDING.how.steps.map((s) => (
            <div
              key={s.n}
              className="glass-card p-5 text-center transition-colors hover:border-primary/35"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-primary/25 bg-primary/15 text-lg font-bold text-primary">
                {s.n}
              </span>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
