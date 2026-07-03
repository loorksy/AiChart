import type { OhlcCandle } from "@/lib/ohlc/fetchOhlc";
import type { ChartDrawing } from "@/lib/chartDrawings";
import { segmentFromPivots } from "./drawings";
import { extractPivots, lastHighs, lastLows, type Pivot } from "./pivots";

export interface Trendline {
  kind: "support" | "resistance";
  from: Pivot;
  to: Pivot;
  slopePerBar: number;
  /** Projected price at the latest candle along the line. */
  projectedNow: number;
}

export interface TrendlineAnalysis {
  support: Trendline | null;
  resistance: Trendline | null;
  drawings: ChartDrawing[];
}

function buildLine(a: Pivot, b: Pivot, kind: "support" | "resistance", lastIndex: number): Trendline {
  const span = b.index - a.index || 1;
  const slopePerBar = (b.price - a.price) / span;
  const projectedNow = b.price + slopePerBar * (lastIndex - b.index);
  return { kind, from: a, to: b, slopePerBar, projectedNow };
}

export function analyzeTrendlines(candles: OhlcCandle[]): TrendlineAnalysis {
  const pivots = extractPivots(candles);
  const lastIndex = candles.length - 1;
  const highs = lastHighs(pivots, 3);
  const lows = lastLows(pivots, 3);

  const resistance =
    highs.length >= 2
      ? buildLine(highs[0]!, highs[highs.length - 1]!, "resistance", lastIndex)
      : null;
  const support =
    lows.length >= 2
      ? buildLine(lows[0]!, lows[lows.length - 1]!, "support", lastIndex)
      : null;

  const drawings: ChartDrawing[] = [];
  if (resistance) {
    drawings.push(
      segmentFromPivots(
        resistance.from,
        resistance.to,
        candles,
        62,
        "خط اتجاه علوي",
      ),
    );
  }
  if (support) {
    drawings.push(
      segmentFromPivots(
        support.from,
        support.to,
        candles,
        62,
        "خط اتجاه سفلي",
      ),
    );
  }

  return { support, resistance, drawings };
}

/** Arabic block for LLM — trendline POI for limit entries. */
export function formatTrendlinesForPrompt(tl: TrendlineAnalysis): string {
  const lines = ["— خطوط اتجاه (POI للدخول عند اللمس — لا مطاردة) —"];
  if (tl.support) {
    lines.push(
      `دعم/اتجاه سفلي: من ${tl.support.from.price.toFixed(2)} → ${tl.support.to.price.toFixed(2)} · إسقاط الآن @ ${tl.support.projectedNow.toFixed(2)}`,
    );
  }
  if (tl.resistance) {
    lines.push(
      `مقاومة/اتجاه علوي: من ${tl.resistance.from.price.toFixed(2)} → ${tl.resistance.to.price.toFixed(2)} · إسقاط الآن @ ${tl.resistance.projectedNow.toFixed(2)}`,
    );
  }
  if (!tl.support && !tl.resistance) {
    lines.push("لا خط اتجاه واضح — اعتمد swing structure.");
  }
  return lines.join("\n");
}
