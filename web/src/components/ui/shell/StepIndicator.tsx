import { cn } from "@/lib/utils";

export function StepIndicator({
  current,
  total = 4,
  labels,
}: {
  current: number;
  total?: number;
  labels?: string[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {Array.from({ length: total }, (_, i) => {
          const step = i + 1;
          const active = step === current;
          const done = step < current;
          return (
            <div key={step} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition",
                  active && "bg-primary text-primary-foreground",
                  done && "bg-accent-gold/20 text-accent-gold",
                  !active && !done && "bg-secondary text-muted-foreground",
                )}
              >
                {String(step).padStart(2, "0")}
              </div>
              {i < total - 1 && (
                <div
                  className={cn(
                    "h-0.5 flex-1 rounded-full",
                    done ? "bg-accent-gold/40" : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      {labels?.[current - 1] && (
        <p className="font-serif text-sm text-accent-gold">
          {labels[current - 1]}
        </p>
      )}
    </div>
  );
}
