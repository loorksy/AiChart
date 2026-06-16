import { SurfaceCard } from "@/components/ui/shell";
import { LANDING } from "@/components/landing/landingContent";

export function LandingFeatures() {
  return (
    <section id="features" className="border-t border-border bg-card/30 py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="mb-10 text-center text-2xl font-bold sm:text-3xl">
          {LANDING.features.title}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LANDING.features.items.map((f) => (
            <SurfaceCard key={f.title} className="h-full">
              <h3 className="font-semibold text-primary">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </SurfaceCard>
          ))}
        </div>
      </div>
    </section>
  );
}
