"use client";

import { useRef, useState } from "react";
import { Check, Clock3 } from "lucide-react";
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
        testId="composer-interval-menu"
      >
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            type="button"
            onClick={() => {
              onSelect(iv);
              setOpen(false);
            }}
            data-active={iv === interval}
            className="composer-sheet-item tabular-nums"
            dir="ltr"
          >
            <span>{iv}</span>
            {iv === interval && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          </button>
        ))}
      </ComposerPopover>
    </>
  );
}
