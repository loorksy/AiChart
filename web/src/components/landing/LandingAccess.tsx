import Link from "next/link";
import { LANDING } from "@/components/landing/landingContent";

export function LandingAccess() {
  return (
    <section className="border-t border-border/60 py-16 sm:py-20">
      <div className="glass-card mx-auto max-w-3xl px-6 py-10 text-center sm:px-8">
        <h2 className="text-2xl font-bold">{LANDING.access.title}</h2>
        <p className="mt-4 text-muted-foreground">{LANDING.access.desc}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" className="btn btn-primary inline-flex">
            {LANDING.hero.ctaPrimary}
          </Link>
          <Link href="/login" className="btn btn-secondary inline-flex">
            {LANDING.hero.ctaSecondary}
          </Link>
        </div>
      </div>
    </section>
  );
}
