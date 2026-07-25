import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { ApiError, handleError } from "@/lib/api";
import type { ResearchTimeframe } from "@/lib/research";
import { DEFAULT_BACKTEST_NOTIONAL_CAPITAL, resolveBacktestNotionalCapital } from "@/lib/strategies/backtestCapital";
import {
  PipelineSubmitError,
  submitStrategyBacktest,
} from "@/lib/strategies/pipeline";

const schema = z
  .object({
    // Membership is validated inside the shared submit flow (the id list is
    // runtime-generated, so a compile-time z.enum no longer fits).
    strategy_id: z.string().min(3).max(128),
    symbol: z.string().min(1).max(32),
    timeframe: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]),
    date_range: z
      .object({
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
      })
      .strict(),
    /** Simulation-only capital for historical sizing. Never live broker equity. */
    notional_capital: z
      .number()
      .finite()
      .min(100)
      .max(10_000_000)
      .optional()
      .default(DEFAULT_BACKTEST_NOTIONAL_CAPITAL),
  })
  .strict();

/**
 * Manual single-backtest entry point. Delegates to the SAME submit flow the
 * mass pipeline uses (cost evidence → warehouse export → spec → research job
 * → pending evidence row), so manual and pipeline runs are indistinguishable
 * to the statistical gates.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());

    let notionalCapital: number;
    try {
      notionalCapital = resolveBacktestNotionalCapital(body.notional_capital);
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error ? error.message : "Invalid notional_capital",
      );
    }

    const { created, backtest } = await submitStrategyBacktest({
      userId,
      strategyId: body.strategy_id,
      symbol: body.symbol,
      timeframe: body.timeframe as ResearchTimeframe,
      fromMs: Date.parse(body.date_range.from),
      toMs: Date.parse(body.date_range.to),
      notionalCapital,
      requestId: req.headers.get("x-request-id")?.trim() || randomUUID(),
    });

    return NextResponse.json(
      {
        ok: true,
        created: created.created,
        backtest,
        notional_capital: notionalCapital,
        research_job: {
          job_id: created.job.job_id,
          status: created.job.status,
          progress_percent: created.job.progress_percent,
        },
      },
      { status: created.created ? 202 : 200 },
    );
  } catch (error) {
    if (error instanceof PipelineSubmitError) {
      return handleError(new ApiError(error.status, error.message));
    }
    return handleError(error);
  }
}
