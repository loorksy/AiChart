import { cn } from "@/lib/utils";
import { SurfaceCard } from "@/components/ui/shell";
import type { LucideIcon } from "lucide-react";

export type KpiTone = "neutral" | "positive" | "negative" | "gold";

const TONE_CLASS: Record<KpiTone, string> = {
  neutral: "text-foreground",
  positive: "text-chart-1",
  negative: "text-destructive",
  gold: "text-accent-gold",
};

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  tone?: KpiTone;
  className?: string;
}) {
  return (
    <SurfaceCard padding="sm" className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground sm:text-xs">{label}</p>
        {Icon && <Icon className={cn("h-4 w-4 shrink-0", TONE_CLASS[tone])} />}
      </div>
      <p
        className={cn(
          "font-serif text-lg font-bold sm:text-2xl",
          TONE_CLASS[tone],
        )}
        dir="ltr"
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground sm:text-xs">{sub}</p>}
    </SurfaceCard>
  );
}
