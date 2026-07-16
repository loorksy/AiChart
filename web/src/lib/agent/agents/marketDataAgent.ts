import type { AgentRunContext, AgentChartContext } from "../types";
import type { CoverageAnalysisKind } from "../dataQualityPolicy";
import {
  buildAgentMarketContext,
  type AgentMarketContext,
} from "../marketContext/buildAgentMarketContext";

/** Gathers warehouse candles + derived context. First agent in the chain. */
export async function runMarketDataAgent(
  ctx: AgentRunContext,
  input: AgentChartContext & {
    spread?: number | null;
    analysisKind?: CoverageAnalysisKind;
  },
): Promise<AgentMarketContext> {
  const symbol = input.symbol ?? "EURUSD";
  const interval = input.interval ?? "15m";

  ctx.emitActivity({
    type: "data",
    status: "started",
    message: `أفحص بيانات ${symbol} على فريم ${interval} من مخزن الشموع.`,
    metadata: { symbol, interval, analysisKind: input.analysisKind },
  });

  const market = await buildAgentMarketContext({
    userId: ctx.userId,
    symbol,
    interval,
    visibleRange: input.visibleRange,
    latestCandle: input.latestCandle,
    dataSource: input.dataSource,
    spread: input.spread ?? null,
    analysisKind: input.analysisKind,
  });

  const coverage = market.dataQuality.coverage;
  if (!market.dataQuality.sufficient || coverage?.status === "refill_required") {
    ctx.emitActivity({
      type: "data",
      status: "warning",
      message:
        coverage?.summaryAr ??
        "تغطية الشموع غير مكتملة — طلبت استكمال البيانات الناقصة من المصدر المعتمد.",
      metadata: {
        ...market.dataQuality,
        refill: coverage?.timeframes?.map((t) => ({
          interval: t.interval,
          available: t.available,
          required: t.required,
          refillAttempted: t.refillAttempted,
          refillStatus: t.refillStatus,
        })),
      },
    });
  } else {
    ctx.emitActivity({
      type: "data",
      status: "completed",
      message: `جهّزت بيانات ${symbol} على فريم ${interval} (${market.dataQuality.currentTfCount} شمعة).`,
      metadata: market.dataQuality,
    });
  }

  if (!market.freshness.isFresh && market.freshness.reason) {
    ctx.emitActivity({
      type: "data",
      status: "warning",
      message: `ملاحظة على حداثة البيانات: ${market.freshness.reason}.`,
      metadata: { ...market.freshness },
    });
  }

  if (!market.sync.ok) {
    ctx.emitActivity({
      type: "data",
      status: "failed",
      message: market.sync.reason,
      metadata: {
        warehouseLastTime: market.sync.warehouseLastTime,
        liveLastTime: market.sync.liveLastTime,
        chartLastTime: market.sync.chartLastTime,
      },
    });
  }

  return market;
}
