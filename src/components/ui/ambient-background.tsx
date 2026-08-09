"use client";

import { cn } from "@/lib/utils";

/** Subtle neutral atmosphere — no purple orbs / neon blur. */
export function AmbientBackground({ className }: { className?: string }) {
  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden
    >
      <div className="absolute inset-0 bg-gradient-to-b from-muted/40 via-transparent to-transparent" />
    </div>
  );
}
