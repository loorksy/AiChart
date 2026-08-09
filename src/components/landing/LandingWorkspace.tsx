"use client";

import { History, LineChart, MessageSquare, Target } from "lucide-react";
import { useLocale } from "@/components/LocaleProvider";
import { Surface } from "@/components/foundation";
import { getLandingCopy } from "@/components/landing/landingCopy";

const POINT_ICONS = [LineChart, MessageSquare, Target, History] as const;

/**
 * "One workspace" — feature list + a static, non-interactive visual.
 * The single live-looking workspace preview lives in the hero only (spec §3).
 */
export function LandingWorkspace() {
  const { locale } = useLocale();
  const c = getLandingCopy(locale).workspace;

  return (
    <section
      data-testid="landing-workspace"
      className="border-b border-border"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {c.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{c.subtitle}</p>
          <ul className="mt-8 space-y-3">
            {c.points.map((point) => (
              <li
                key={point}
                className="flex gap-3 text-sm leading-relaxed text-foreground/90"
              >
                <span
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground"
                  aria-hidden
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Static visual — decorative pane arrangement, no data, no motion. */}
        <Surface padding="none" className="overflow-hidden" aria-hidden="true">
          <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
            <span className="size-2 rounded-full bg-muted-foreground/40" />
            <span className="size-2 rounded-full bg-muted-foreground/25" />
            <span className="size-2 rounded-full bg-muted-foreground/15" />
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            {c.points.map((point, index) => {
              const Icon = POINT_ICONS[index % POINT_ICONS.length]!;
              return (
                <div
                  key={point}
                  className="rounded-[var(--radius)] bg-muted/50 p-3"
                >
                  <Icon
                    className="mb-2 size-4 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                  <div className="h-2 w-3/4 rounded-full bg-foreground/15" />
                  <div className="mt-1.5 h-2 w-1/2 rounded-full bg-foreground/10" />
                </div>
              );
            })}
          </div>
        </Surface>
      </div>
    </section>
  );
}
