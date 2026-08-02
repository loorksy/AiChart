"use client";

import { useRef, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { ComposerPopover } from "@/components/agent/ComposerPopover";
import { PairFlags } from "@/components/agent/CurrencyFlag";
import { SymbolPickerSheet } from "@/components/agent/SymbolPickerSheet";
import { useSheetSlot } from "@/components/shell/SheetCoordinator";
import { cn } from "@/lib/utils";

const TRIGGER_CLASS =
  "flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold tabular-nums transition-colors duration-150 ease-out sm:min-h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The pair the next question is about, chosen where the question is typed.
 *
 * The trigger carries the pair's own flags so the current instrument is
 * recognisable without reading it; the choosing itself happens in the card
 * catalogue (see {@link SymbolPickerSheet}), which is a change of surface — it
 * takes the sheet slot, so it swaps with the chart rather than stacking on it.
 */
export function ComposerSymbolPicker({
  symbol,
  brokerConnected,
  onSelect,
}: {
  symbol: string;
  brokerConnected: boolean;
  onSelect: (symbol: string, source: "oanda" | "ea") => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useSheetSlot("symbolPicker");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={t("trades.col.symbol")}
        title={t("trades.col.symbol")}
        data-testid="composer-symbol"
        className={cn(
          TRIGGER_CLASS,
          open ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <PairFlags symbol={symbol} size={16} className="me-0.5" />
        <span dir="ltr">{symbol}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      </button>

      <SymbolPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        symbol={symbol}
        brokerConnected={brokerConnected}
        onSelect={onSelect}
      />
    </>
  );
}

/** The intervals the chart itself understands — same table TvChart maps from. */
const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"] as const;

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
        className={cn(
          TRIGGER_CLASS,
          open ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
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
