"use client";

import { ChartBackdrop } from "@/components/chart/ChartBackdrop";
import { cn } from "@/lib/utils";

/**
 * Decorative live chart backdrop — blurred & muted so foreground UI stays readable.
 */
export function ChartBackground({
  symbol = "EURUSD",
  interval = "1h",
  className,
  children,
}: {
  symbol?: string;
  interval?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative min-h-dvh", className)}>
      <div
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
        aria-hidden
      >
        <div className="chart-bg-canvas absolute -inset-[15%]">
          <ChartBackdrop className="h-full w-full" />
        </div>
        <div className="absolute inset-0 bg-background/94" />
      </div>
      <div className="relative z-10 flex min-h-dvh flex-col">{children}</div>
    </div>
  );
}
