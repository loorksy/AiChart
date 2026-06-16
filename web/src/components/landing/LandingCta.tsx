import Link from "next/link";
import { LANDING } from "@/components/landing/landingContent";

export function LandingCta() {
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-2xl font-bold sm:text-3xl">{LANDING.cta.title}</h2>
        <p className="mt-3 text-muted-foreground">{LANDING.cta.subtitle}</p>
        <Link href="/signup" className="btn btn-primary mt-8 inline-flex text-base">
          {LANDING.cta.button}
        </Link>
      </div>
    </section>
  );
}
