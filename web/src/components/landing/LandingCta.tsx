import Link from "next/link";
import { LANDING } from "@/components/landing/landingContent";

export function LandingCta() {
  return (
    <section className="py-16 sm:py-20">
      <div className="glass-card mx-auto max-w-3xl border-primary/30 px-6 py-12 text-center sm:px-8">
        <h2 className="text-2xl font-bold sm:text-3xl">{LANDING.cta.title}</h2>
        <p className="mt-3 text-muted-foreground">{LANDING.cta.subtitle}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" className="btn btn-primary inline-flex text-base">
            {LANDING.cta.button}
          </Link>
          <Link href="/login" className="btn btn-secondary inline-flex text-base">
            {LANDING.hero.ctaSecondary}
          </Link>
        </div>
      </div>
    </section>
  );
}
