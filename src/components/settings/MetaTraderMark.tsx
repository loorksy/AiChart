import { cn } from "@/lib/utils";

/**
 * Official MetaTrader 5 lockup from the MetaQuotes media gallery.
 * Colors and layout are the product identity — do not recolor.
 */
export function MetaTraderMark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/metatrader-5.svg"
      alt="MetaTrader 5"
      className={cn("h-8 w-auto", className)}
    />
  );
}
