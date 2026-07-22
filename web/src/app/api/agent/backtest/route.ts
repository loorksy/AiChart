import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { ApiError, handleError } from "@/lib/api";
import { getRiskBudget } from "@/lib/execution";
import { barDurationMs } from "@/lib/intervals";
import { normalizeSymbol } from "@/lib/markets/symbolMapping";
import {
  exportAiChartCandleWarehouse,
  researchValidationEnabled,
  runForexBacktest,
} from "@/lib/research";
import type { ResearchTimeframe } from "@/lib/research";
import { resolveBrokerForMarket } from "@/lib/store";
import {
  BACKTEST_STRATEGY_IDS,
  buildBacktestStrategySpec,
} from "@/lib/strategies/catalog";
import { getStrategyCostEvidence } from "@/lib/strategies/costProfile";
import { recordPendingStrategyBacktest } from "@/lib/strategies/evidence";

const schema = z
  .object({
    strategy_id: z.enum(BACKTEST_STRATEGY_IDS),
    symbol: z.string().min(1).max(32),
    timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]),
    date_range: z
      .object({
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    if (!researchValidationEnabled()) {
      throw new ApiError(
        503,
        "The complete backtest + validation pipeline is disabled; enable RESEARCH_SERVICE_ENABLED, RESEARCH_BACKTEST_ENABLED, and RESEARCH_VALIDATION_ENABLED",
      );
    }
    const symbol = normalizeSymbol(body.symbol).canonical;
    const fromMs = Date.parse(body.date_range.from);
    const toMs = Date.parse(body.date_range.to);
    if (!(fromMs > 0 && toMs > fromMs && toMs <= Date.now())) {
      throw new ApiError(400, "date_range must be ordered and end in the past");
    }
    const timeframe = body.timeframe as ResearchTimeframe;
    const estimatedBars = Math.ceil((toMs - fromMs) / barDurationMs(timeframe));
    if (estimatedBars > 10_000) {
      throw new ApiError(
        400,
        "This synchronous run exceeds 10,000 bars; use a higher timeframe or a shorter range while the historical artifact exporter processes longer ranges",
      );
    }
    const broker = await resolveBrokerForMarket(userId, "forex");
    const budget = await getRiskBudget(userId, broker);
    if (!budget) {
      throw new ApiError(409, "Verified broker equity is required for backtest sizing");
    }
    const costs = await getStrategyCostEvidence(userId, symbol);
    const dataset = await exportAiChartCandleWarehouse({
      symbol,
      timeframe,
      fromMs,
      toMs,
      limit: 10_000,
    });
    if (dataset.bars.length < 200) {
      throw new ApiError(
        409,
        `Historical warehouse coverage is insufficient (${dataset.bars.length} closed bars; at least 200 required)`,
      );
    }
    const strategySpec = buildBacktestStrategySpec({
      strategyId: body.strategy_id,
      symbol,
      timeframe,
      costs,
    });
    const requestId = req.headers.get("x-request-id")?.trim() || randomUUID();
    const idempotencyKey = [
      "strategy-backtest",
      userId,
      body.strategy_id,
      symbol,
      timeframe,
      fromMs,
      toMs,
    ].join(":");
    const created = await runForexBacktest(
      { userId, requestId },
      {
        idempotencyKey,
        timeoutSeconds: 300,
        strategySpec,
        dataset: { source: "aichart_candle_warehouse", payload: dataset },
        runConfig: {
          initialCapital: budget.equity,
          accountCurrency: budget.currency || "USD",
          seed: 42,
          intrabarPolicy: "worst_case",
          leverage: 30,
          startTime: new Date(fromMs).toISOString(),
          endTime: new Date(toMs).toISOString(),
        },
        limits: {
          maxRows: 10_000,
          maxSymbols: 1,
          maxDateRangeDays: Math.ceil((toMs - fromMs) / 86_400_000) + 1,
        },
      },
    );
    const backtest = await recordPendingStrategyBacktest({
      userId,
      strategyId: body.strategy_id,
      strategyVersion: `${body.strategy_id}.1`,
      symbol,
      timeframe,
      jobId: created.job.job_id,
      request: {
        date_range: {
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
        },
        candle_count: dataset.bars.length,
        cost_evidence: costs,
        initial_capital: budget.equity,
        account_currency: budget.currency,
      },
    });
    return NextResponse.json(
      {
        ok: true,
        created: created.created,
        backtest,
        research_job: {
          job_id: created.job.job_id,
          status: created.job.status,
          progress_percent: created.job.progress_percent,
        },
      },
      { status: created.created ? 202 : 200 },
    );
  } catch (error) {
    return handleError(error);
  }
}

