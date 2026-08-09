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
const POSITION_TYPES = new Set(["long_position", "short_position"]);

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

/** TV long/short box — profit zone must reflect actual R:R (not 1:1). */
export function buildPositionDrawing(
  setup: TradeSetup,
  candles: OhlcCandle[],
): ChartDrawing | null {
  if (setup.action === "wait" || candles.length === 0) return null;
  const entry = setup.entry;
  const sl = setup.stop_loss;
  const tp = setup.targets.find((t) => t > 0);
  if (entry == null || sl == null || tp == null) return null;

  const lastTime = candles[candles.length - 1]?.time ?? Math.floor(Date.now() / 1000);
  const kind = setup.action === "buy" ? "long_position" : "short_position";
  return {
    type: kind,
    label: setup.action === "buy" ? "مركز شراء" : "مركز بيع",
    confidence: setup.confidence,
    points: [{ time: lastTime, price: entry, barsAhead: undefined }],
    meta: { entry, stopLoss: sl, takeProfit: tp },
  };
}

/** Prepend trade levels + position box; drop agent trade lines and stale positions. */
export function mergeTradeLevelDrawings(
  existing: ChartDrawing[],
  setup: TradeSetup,
  candles: OhlcCandle[],
): ChartDrawing[] {
  const trade = buildTradeLevelDrawings(setup, candles);
  const position = buildPositionDrawing(setup, candles);
  if (trade.length === 0 && !position) return existing;

  const rest = existing.filter(
    (d) =>
      (!d.semanticRole || !TRADE_ROLES.has(d.semanticRole)) &&
      !POSITION_TYPES.has(d.type),
  );
  const head = position ? [...trade, position] : trade;
  const room = Math.max(0, MAX_CHART_DRAWINGS - head.length);
  return [...head, ...rest.slice(0, room)];
}
