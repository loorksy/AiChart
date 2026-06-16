"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { LANDING } from "@/components/landing/landingContent";
import { cn } from "@/lib/utils";

export function LandingFaq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="bg-card/30 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <h2 className="mb-8 text-center text-2xl font-bold">{LANDING.faq.title}</h2>
        <div className="space-y-2">
          {LANDING.faq.items.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q} className="rounded-xl border border-border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-4 p-4 text-right text-sm font-medium"
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  {item.q}
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                {isOpen && (
                  <p className="border-t border-border px-4 pb-4 pt-2 text-sm text-muted-foreground">
                    {item.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
