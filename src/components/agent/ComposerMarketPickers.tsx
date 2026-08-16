"use client";

import { useRef, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ComposerPopover } from "@/components/agent/ComposerPopover";
import { cn } from "@/lib/utils";
import { TIMEFRAMES } from "@/lib/gold";

const TRIGGER_CLASS =
  "metal-chip shrink-0 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** The only timeframes this platform analyses — see lib/gold.ts. */
const INTERVALS = TIMEFRAMES;

export function ComposerIntervalPicker({
  interval,
  onSelect,
}: {
  interval: string;
  onSelect: (interval: string) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("layout.chart")}
        data-testid="composer-interval"
        className={cn(TRIGGER_CLASS, open && "text-foreground")}
      >
        <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span dir="ltr">{interval}</span>
      </button>

      <ComposerPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        title={t("layout.chart")}
      >
        <div className="grid grid-cols-4 gap-1 p-2">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => {
                onSelect(iv);
                setOpen(false);
              }}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-lg text-xs tabular-nums transition-colors hover:bg-muted sm:min-h-9",
                iv === interval
                  ? "bg-muted font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
              dir="ltr"
            >
              {iv}
            </button>
          ))}
        </div>
      </ComposerPopover>
    </>
  );
}
