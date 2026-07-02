import { priceLineDrawing } from "@/lib/analysis/drawings";
import type { ChartDrawing, SemanticRole } from "@/lib/chartDrawings";
import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";

const TRADE_ROLES = new Set<SemanticRole>(["entry", "stop_loss", "take_profit"]);

export interface TradeSetup {
  entry: number | null;
  stop_loss: number | null;
  targets: number[];
  confidence: number;
  action: "buy" | "sell" | "wait";
}

const MAX_CHART_DRAWINGS = 12;

/** Horizontal price lines for entry, stop-loss, and take-profit targets. */
export function buildTradeLevelDrawings(
  setup: TradeSetup,
  candles: OhlcCandle[],
): ChartDrawing[] {
  if (setup.action === "wait" || candles.length === 0) return [];

  const out: ChartDrawing[] = [];

  if (setup.entry != null && setup.entry > 0) {
    out.push(
      priceLineDrawing(
        setup.entry,
        setup.confidence,
        "دخول",
        candles,
        "#22c55e",
        "entry",
      ),
    );
  }
  if (setup.stop_loss != null && setup.stop_loss > 0) {
    out.push(
      priceLineDrawing(
        setup.stop_loss,
        setup.confidence,
        "وقف خسارة",
        candles,
        "#ef4444",
        "stop_loss",
      ),
    );
  }
  setup.targets
    .filter((t) => typeof t === "number" && t > 0)
    .forEach((target, i) => {
      out.push(
        priceLineDrawing(
          target,
          setup.confidence,
          setup.targets.length > 1 ? `هدف ${i + 1}` : "هدف ربح",
          candles,
          "#3b82f6",
          "take_profit",
        ),
      );
    });

  return out;
}

/** Prepend trade levels; drop duplicate trade-role lines from agent output. */
export function mergeTradeLevelDrawings(
  existing: ChartDrawing[],
  setup: TradeSetup,
  candles: OhlcCandle[],
): ChartDrawing[] {
  const trade = buildTradeLevelDrawings(setup, candles);
  if (trade.length === 0) return existing;

  const rest = existing.filter(
    (d) => !d.semanticRole || !TRADE_ROLES.has(d.semanticRole),
  );
  const room = Math.max(0, MAX_CHART_DRAWINGS - trade.length);
  return [...trade, ...rest.slice(0, room)];
}
