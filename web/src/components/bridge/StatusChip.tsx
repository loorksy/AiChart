import { cn } from "@/lib/utils";

export type StatusChipTone = "ok" | "warn" | "error" | "neutral";

const TONE: Record<StatusChipTone, string> = {
  ok: "bg-chart-1/15 text-chart-1 border-chart-1/30",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
  neutral: "bg-secondary text-muted-foreground border-border",
};

export function StatusChip({
  label,
  tone = "neutral",
  dot = true,
  className,
}: {
  label: string;
  tone?: StatusChipTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        TONE[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "ok" && "bg-chart-1",
            tone === "warn" && "bg-amber-500",
            tone === "error" && "bg-destructive",
            tone === "neutral" && "bg-muted-foreground",
          )}
        />
      )}
      {label}
    </span>
  );
}
