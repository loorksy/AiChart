"use client";

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function BentoCard({
  className,
  children,
  glow = false,
}: {
  className?: string;
  children: React.ReactNode;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "glass-card group relative overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:border-primary/30",
        glow && "glow-amber",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function BentoStat({
  icon: Icon,
  label,
  value,
  hint,
  accent = "primary",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  accent?: "primary" | "destructive" | "chart-1";
}) {
  const accentClass =
    accent === "destructive"
      ? "text-destructive bg-destructive/10"
      : accent === "chart-1"
        ? "text-chart-1 bg-chart-1/10"
        : "text-primary bg-primary/10";

  return (
    <BentoCard>
      <div className="mb-4 flex items-center justify-between">
        <div className={cn("rounded-xl p-2.5", accentClass)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </BentoCard>
  );
}
