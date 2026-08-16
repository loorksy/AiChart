import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { verifyCronSecret } from "@/lib/cronAuth";
import { createLogger } from "@/lib/logger";
import { queryOne } from "@/lib/db";
import { sweepStrategyBacktests } from "@/lib/strategies/backtestRunner";

const log = createLogger("cron.strategy-backtests");

/**
 * The nightly precompute.
 *
 * Walks the catalogue against the gold candle store, submitting the claims the
 * cache does not already hold. Submission-bounded rather than
 * catalogue-bounded: ~60 strategies across five timeframes is 300 research
 * jobs, and firing them in one night would spend a month of budget on the
 * first run. The cache makes the sweep resumable — each run picks up where the
 * last one stopped, and re-reads what it already answered.
 *
 * Runs under ONE owner. Validated strategy statistics are platform evidence
 * rather than personal data (the support lookup already falls back to the
 * newest rows regardless of owner), so a per-user sweep would pay the same
 * research bill once per operator to compute the same numbers.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configured = Number(process.env.STRATEGY_PIPELINE_USER_ID);
  const userId = Number.isInteger(configured) && configured > 0 ? configured : null;
  if (userId == null) {
    // Naming the missing configuration beats a silent no-op that looks like a
    // sweep with nothing to do.
    return NextResponse.json(
      {
        ok: false,
        error:
          "STRATEGY_PIPELINE_USER_ID is not configured — the backtest sweep has no owner to run as",
      },
      { status: 503 },
    );
  }
  const owner = await queryOne<{ id: number }>("SELECT id FROM users WHERE id = ?", [
    userId,
  ]).catch(() => null);
  if (!owner) {
    return NextResponse.json(
      { ok: false, error: `STRATEGY_PIPELINE_USER_ID ${userId} does not exist` },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const maxParam = Number(url.searchParams.get("max"));
  const timeframe = url.searchParams.get("timeframe");

  try {
    const report = await sweepStrategyBacktests({
      userId,
      requestId: randomUUID(),
      maxSubmissions: Number.isFinite(maxParam) ? maxParam : undefined,
      timeframes: timeframe ? [timeframe] : undefined,
    });
    log.info("strategy.sweep.complete", {
      submitted: report.submitted,
      cached: report.cached,
      skipped: report.skipped,
    });
    return NextResponse.json({ ok: true, ...report });
  } catch (error) {
    log.error("strategy.sweep.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "sweep failed" },
      { status: 503 },
    );
  }
}
