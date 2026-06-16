import Link from "next/link";
import { LANDING } from "@/components/landing/landingContent";

export function LandingAccess() {
  return (
    <section className="border-t border-border py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-2xl font-bold">{LANDING.access.title}</h2>
        <p className="mt-4 text-muted-foreground">{LANDING.access.desc}</p>
        <Link href="/signup" className="btn btn-primary mt-8 inline-flex">
          {LANDING.hero.ctaPrimary}
        </Link>
      </div>
    </section>
  );
}
