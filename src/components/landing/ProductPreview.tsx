"use client";

import { AnimatedAgentAvatar } from "@/components/AnimatedAgentAvatar";
import { useLocale } from "@/components/LocaleProvider";
import { getLandingCopy } from "@/components/landing/landingCopy";
import { cn } from "@/lib/utils";

/** Static illustrative product preview — no live chart library, no live prices. */
export function ProductPreview({ className }: { className?: string }) {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).preview;

  return (
    <figure
      data-testid="landing-product-preview"
      className={cn(
        "overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card text-start elevation-1",
        className,
      )}
    >
      <figcaption className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
        <span>{c.label}</span>
        <span className="rounded-md border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide">
          {c.illustrative}
        </span>
      </figcaption>

      <div className="grid min-h-[280px] md:grid-cols-[1.15fr_0.85fr]">
        {/* Chart pane — decorative bars only */}
        <div className="relative border-b border-border bg-background p-4 md:border-b-0 md:border-e">
          <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{c.chartPane}</span>
            <span>XAUUSD · 15</span>
          </div>
          <div
            className="flex h-40 items-end gap-1.5 px-1"
            aria-hidden
            role="presentation"
          >
            {[42, 55, 48, 62, 58, 70, 64, 72, 68, 75, 71, 78, 74, 80, 76].map(
              (h, i) => (
                <div
                  key={i}
                  className={cn(
                    // Trading semantics (spec §1): up = buy, down = sell —
                    // never destructive/raw greens for market direction.
                    "w-full max-w-[14px] rounded-sm",
                    i % 3 === 0 ? "bg-sell/55" : "bg-buy/55",
                  )}
                  style={{ height: `${h}%` }}
                />
              ),
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-4 bottom-4 top-14 rounded-lg border border-dashed border-border/70" />
        </div>

        {/* Chat pane */}
        <div className="flex flex-col bg-background p-4">
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <AnimatedAgentAvatar size={28} state="idle" />
            <span className="font-medium text-foreground">{c.chatPane}</span>
          </div>
          <p className="mb-3 text-sm leading-relaxed text-foreground/90">
            {c.agentGreeting}
          </p>
          <div className="mt-auto rounded-[var(--radius)] bg-muted/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">
                {c.recommendationTitle}
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                {c.side}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
              <div>
                <dt className="inline">{c.entry}: </dt>
                <dd className="inline text-foreground">—</dd>
              </div>
              <div>
                <dt className="inline">{c.stop}: </dt>
                <dd className="inline text-foreground">—</dd>
              </div>
              <div>
                <dt className="inline">{c.target}: </dt>
                <dd className="inline text-foreground">—</dd>
              </div>
              <div className="col-span-2">
                <dt className="inline">{c.status}: </dt>
                <dd className="inline text-foreground">{c.statusValue}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </figure>
  );
}
