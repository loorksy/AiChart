import { cn } from "@/lib/utils";

export type StatusChipTone = "ok" | "warn" | "error" | "neutral";

/* Premium animated pill indicator with pulsing dot */
const TONE: Record<
  StatusChipTone,
  { pill: string; dot: string; ping: string }
> = {
  ok: {
    pill: "bg-green-500/10 text-green-400 border-green-500/25",
    dot: "bg-green-400",
    ping: "bg-green-400",
  },
  warn: {
    pill: "bg-amber-500/10 text-amber-400 border-amber-500/25",
    dot: "bg-amber-400",
    ping: "bg-amber-400",
  },
  error: {
    pill: "bg-red-500/10 text-red-400 border-red-500/25",
    dot: "bg-red-400",
    ping: "bg-red-400",
  },
  neutral: {
    pill: "bg-zinc-800/60 text-zinc-500 border-zinc-700/40",
    dot: "bg-zinc-600",
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
