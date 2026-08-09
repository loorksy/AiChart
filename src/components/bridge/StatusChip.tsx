import { cn } from "@/lib/utils";

export type StatusChipTone = "ok" | "warn" | "error" | "neutral";

/* Premium animated pill indicator with pulsing dot */
const TONE: Record<
  StatusChipTone,
  { pill: string; dot: string; ping: string }
> = {
  // Tokens, not raw palette steps: a fixed `*-400` foreground is tuned for the
  // dark surface only, so on the light console these pills rendered as dark
  // slugs with near-unreadable text. Every token below carries its own
  // light/dark pair.
  ok: {
    pill: "bg-buy/10 text-buy border-buy/25",
    dot: "bg-buy",
    ping: "bg-buy",
  },
  warn: {
    pill: "bg-warning/10 text-warning border-warning/25",
    dot: "bg-warning",
    ping: "bg-warning",
  },
  error: {
    pill: "bg-destructive/10 text-destructive border-destructive/25",
    dot: "bg-destructive",
    ping: "bg-destructive",
  },
  neutral: {
    pill: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground/60",
    ping: "",
  },
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
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide",
        t.pill,
        className,
      )}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          {t.ping && (
            <span
              className={cn(
                "animate-ping absolute inline-flex h-full w-full rounded-full opacity-60",
                t.ping,
              )}
            />
          )}
          <span
            className={cn("relative inline-flex rounded-full h-1.5 w-1.5", t.dot)}
          />
        </span>
      )}
      {label}
    </span>
  );
}
