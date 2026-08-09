"use client";

import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { getLandingCopy, LANDING_ROUTES } from "@/components/landing/landingCopy";

/** FAQ accordion inspired by 21st.dev @meschacirung/faq/faq-accordion-with-title */
export function LandingFaq() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).faq;

  return (
    <section
      id="faq"
      data-testid="landing-faq"
      className="scroll-mt-20 border-b border-border bg-muted/30"
    >
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-y-12 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
          <div className="text-center lg:text-start">
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              {c.title}
            </h2>
            <p className="mt-4 text-muted-foreground">{c.subtitle}</p>
          </div>

          <div>
            <Accordion
              type="single"
              collapsible
              className="w-full rounded-[var(--radius-lg)] border border-border bg-card px-6 py-2 elevation-1"
            >
              {c.items.map((item, index) => (
                <AccordionItem key={item.q} value={`item-${index + 1}`}>
                  <AccordionTrigger>{item.q}</AccordionTrigger>
                  <AccordionContent>{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            <p className="mt-6 text-sm text-muted-foreground">
              {c.contactLead}{" "}
              <Link
                href={LANDING_ROUTES.contact}
                className="font-medium text-foreground hover:underline"
              >
                {c.contactLink}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
