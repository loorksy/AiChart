import { cn } from "@/lib/utils";

/**
 * MetaTrader 5 mark for the in-app login form.
 * Recreated from the public product identity (not a copied binary asset).
 */
export function MetaTraderMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <svg
        viewBox="0 0 64 64"
        className="h-12 w-12 shrink-0 text-info"
        role="img"
        aria-label="MetaTrader 5"
      >
        <rect width="64" height="64" rx="14" fill="currentColor" />
        <path
          fill="var(--destructive-foreground)"
          d="M42.5 16H21v9.2h13.4v5.2H24.8c-5.1 0-8.8 3.6-8.8 8.7 0 5.2 3.8 9.1 9.4 9.1H43v-9.2H26.8c-1.6 0-2.6-1-2.6-2.4 0-1.4 1-2.3 2.6-2.3H42.5V16z"
        />
      </svg>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          MetaQuotes
        </p>
        <p className="text-lg font-semibold leading-tight text-foreground">
          MetaTrader 5
        </p>
      </div>
    </div>
  );
}
