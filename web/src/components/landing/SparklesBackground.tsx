"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

type SparklesProps = {
  className?: string;
  density?: number;
};

/** Lightweight sparkles backdrop inspired by 21st.dev @lepikhinb/sparkles */
export function SparklesBackground({ className, density = 28 }: SparklesProps) {
  const dots = useMemo(
    () =>
      Array.from({ length: density }, (_, index) => ({
        id: index,
        left: `${(index * 17) % 100}%`,
        top: `${(index * 29) % 100}%`,
        size: index % 5 === 0 ? 3 : 2,
        delay: `${(index % 7) * 0.35}s`,
        duration: `${2.8 + (index % 4) * 0.6}s`,
        opacity: 0.18 + (index % 3) * 0.08,
      })),
    [density],
  );

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_55%)]" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
      {dots.map((dot) => (
        <span
          key={dot.id}
          className="absolute rounded-full bg-foreground animate-pulse"
          style={{
            left: dot.left,
            top: dot.top,
            width: dot.size,
            height: dot.size,
            opacity: dot.opacity,
            animationDelay: dot.delay,
            animationDuration: dot.duration,
          }}
        />
      ))}
    </div>
  );
}
