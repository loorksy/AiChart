import { barDurationMs } from "@/lib/intervals";
import type { AgentChartContext } from "../types";
import type { AgentCandle } from "./detectors";

export interface MarketSyncStatus {
  ok: boolean;
  reason: string;
  warehouseLastTime: number | null;
  liveLastTime: number | null;
  chartLastTime: number | null;
  warehouseClose: number | null;
  liveClose: number | null;
  chartClose: number | null;
  tolerance: {
    timeMs: number;
    price: number;
  };
}

function asMs(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  const n = Number(value);
  return n < 1_000_000_000_000 ? Math.round(n * 1000) : Math.round(n);
}

function last(candles: AgentCandle[]): AgentCandle | null {
  return candles.length ? candles[candles.length - 1]! : null;
}

function symbolFallbackTolerance(symbol: string): number {
  const s = symbol.toUpperCase();
  if (s.includes("JPY")) return 0.03;
  if (s.includes("XAU") || s.includes("XAG")) return 1.5;
  return 0.0003;
}

export function marketSyncPriceTolerance(input: {
  symbol: string;
  spread?: number | null;
  atr?: number | null;
}): number {
  const fromSpread = input.spread && input.spread > 0 ? input.spread * 3 : 0;
  const fromAtr = input.atr && input.atr > 0 ? input.atr * 0.1 : 0;
  return Math.max(fromSpread, fromAtr, symbolFallbackTolerance(input.symbol));
}

export function evaluateMarketSync(input: {
  symbol: string;
  interval: string;
  warehouseCandles: AgentCandle[];
  liveCandles: AgentCandle[];
  chartLatestCandle?: AgentChartContext["latestCandle"];
  spread?: number | null;
  atr?: number | null;
  liveError?: string | null;
}): MarketSyncStatus {
  const warehouse = last(input.warehouseCandles);
  const live = last(input.liveCandles);
  const chart = input.chartLatestCandle;
  const timeTolerance = barDurationMs(input.interval) || 60_000;
  const priceTolerance = marketSyncPriceTolerance(input);

  const status: MarketSyncStatus = {
    ok: true,
    reason: "market data synchronized",
    warehouseLastTime: asMs(warehouse?.time),
    liveLastTime: asMs(live?.time),
    chartLastTime: asMs(chart?.time),
    warehouseClose: warehouse?.close ?? null,
    liveClose: live?.close ?? null,
    chartClose: chart?.close ?? null,
    tolerance: { timeMs: timeTolerance, price: priceTolerance },
  };

  const fail = (reason: string): MarketSyncStatus => ({
    ...status,
    ok: false,
    reason,
  });

  if (input.liveError) {
    return fail("تعذّر جلب شمعة حية لمزامنة الوكيل مع الشارت الحالي.");
  }
  if (!warehouse) {
    return fail("لا توجد شموع مخزنة للوكيل بعد.");
  }
  if (!live) {
    return fail("لا توجد شمعة حية للمقارنة مع بيانات الوكيل.");
  }

  if (
    status.warehouseLastTime != null &&
    status.liveLastTime != null &&
    Math.abs(status.liveLastTime - status.warehouseLastTime) > timeTolerance
  ) {
    return fail("بيانات الوكيل غير متزامنة مع الشارت الحالي: آخر شمعة في المخزن تختلف عن آخر شمعة حية.");
  }

  if (
    status.warehouseClose != null &&
    status.liveClose != null &&
    Math.abs(status.liveClose - status.warehouseClose) > priceTolerance
  ) {
    return fail("بيانات الوكيل غير متزامنة مع الشارت الحالي: إغلاق المخزن يختلف عن الإغلاق الحي.");
  }

  if (chart) {
    if (
      status.chartLastTime != null &&
      status.liveLastTime != null &&
      Math.abs(status.chartLastTime - status.liveLastTime) > timeTolerance
    ) {
      return fail("بيانات الوكيل غير متزامنة مع الشارت الحالي: آخر شمعة في الشارت تختلف عن آخر شمعة حية.");
    }
    if (
      status.chartClose != null &&
      status.liveClose != null &&
      Math.abs(status.chartClose - status.liveClose) > priceTolerance
    ) {
      return fail("بيانات الوكيل غير متزامنة مع الشارت الحالي: سعر الشارت الحالي يختلف عن السعر الحي.");
    }
  }

  return status;
}

