import { LANDING } from "@/components/landing/landingContent";

export function LandingIntegrations() {
  return (
    <section className="border-y border-border bg-secondary/30 py-12">
      <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
        <h2 className="mb-8 text-xl font-bold">{LANDING.integrations.title}</h2>
        <div className="flex flex-wrap items-center justify-center gap-4">
          {LANDING.integrations.items.map((name) => (
            <span
              key={name}
              className="rounded-full border border-border bg-card px-5 py-2 text-sm font-medium"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
