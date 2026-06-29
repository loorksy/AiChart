import type { ChartDrawing, ChartPoint } from "@/lib/chartDrawings";
import { computeRewardRisk } from "@/lib/rewardRisk";

export interface TradePlanDrawingInput {
  symbol: string;
  market: string;
  timeframe: string;
  side: "buy" | "sell" | "wait";
  entry?: number | null;
  stopLoss?: number | null;
  takeProfits?: Array<number | null | undefined>;
  startTime?: number | null;
  endTime?: number | null;
}

function point(time: number, price: number): ChartPoint {
  return { time, price };
}

function nowMs(): number {
  return Date.now();
}

function defaultEnd(start: number): number {
  return start + 12 * 60 * 60 * 1000;
}

function meta(input: TradePlanDrawingInput, extra?: Record<string, unknown>) {
  return {
    drawing_scope: {
      symbol: input.symbol,
      market: input.market,
      anchorMode: "time_price" as const,
    },
    sourceTimeframe: input.timeframe,
    ...extra,
  };
}

export function tradePlanToDrawings(input: TradePlanDrawingInput): ChartDrawing[] {
  if (input.side === "wait") return [];
  const entry = Number(input.entry);
  const stopLoss = Number(input.stopLoss);
  const takeProfits = (input.takeProfits ?? [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  const firstTarget = takeProfits[0];
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || !firstTarget) {
    return [];
  }

  const start = input.startTime && input.startTime > 0 ? input.startTime : nowMs();
  const end = input.endTime && input.endTime > start ? input.endTime : defaultEnd(start);
  const rr = computeRewardRisk(entry, stopLoss, firstTarget) ?? undefined;
  const color = input.side === "buy" ? "#22c55e" : "#ef4444";

  const drawings: ChartDrawing[] = [
    {
      type: "risk_reward_box",
      confidence: 90,
      label: "خطة الصفقة",
      semanticRole: "risk_reward",
      anchorMode: "time_price",
      color,
      points: [point(start, entry), point(end, stopLoss), point(end, firstTarget)],
      price: entry,
      price2: stopLoss,
      price3: firstTarget,
      meta: meta(input, {
        entry,
        stopLoss,
        takeProfit: firstTarget,
        riskReward: rr,
        side: input.side,
      }),
    },
    {
      type: "range_box",
      confidence: 86,
      label: "منطقة دخول",
      semanticRole: "entry",
      anchorMode: "time_price",
      color: "#3b82f6",
      fill: true,
      points: [point(start, entry), point(end, entry)],
      meta: meta(input),
    },
    {
      type: "price_line",
      confidence: 84,
      label: "وقف الخسارة",
      semanticRole: "stop_loss",
      anchorMode: "time_price",
      color: "#ef4444",
      style: "dashed",
      points: [point(start, stopLoss)],
      price: stopLoss,
      meta: meta(input),
    },
  ];

  takeProfits.slice(0, 3).forEach((tp, i) => {
    drawings.push({
      type: "price_line",
      confidence: 82 - i,
      label: i === 0 ? "الهدف الأول" : `الهدف ${i + 1}`,
      semanticRole: "take_profit",
      anchorMode: "time_price",
      color: "#22c55e",
      style: i === 0 ? "solid" : "dotted",
      points: [point(start, tp)],
      price: tp,
      meta: meta(input, { targetIndex: i + 1 }),
    });
  });

  const arrowEnd = input.side === "buy" ? firstTarget : stopLoss;
  drawings.push({
    type: "labeled_arrow",
    confidence: 78,
    label: input.side === "buy" ? "سيناريو صاعد" : "سيناريو هابط",
    semanticRole: "forecast",
    anchorMode: "time_price",
    color,
    points: [point(start, entry), point(end, arrowEnd)],
    meta: meta(input),
  });

  return drawings;
}
