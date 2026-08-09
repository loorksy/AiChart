"use client";

/**
 * Quant Agent Chat's right rail (plan §A7) — Watchlist above AI Scheduled
 * Monitors, structurally mirroring QuantDinger-Vue's right rail panel.
 * Original layout only — no code/markup copied from QuantDinger-Vue.
 */
import { WatchlistSection } from "./WatchlistSection";
import { MonitorsSection } from "./MonitorsSection";

export function QuantAgentRightRail({ activeSymbol }: { activeSymbol: string }) {
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      <WatchlistSection />
      <MonitorsSection activeSymbol={activeSymbol} />
    </div>
  );
}
