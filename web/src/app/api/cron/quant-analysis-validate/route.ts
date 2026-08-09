import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveAgentUserId } from "@/lib/agentAuth";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import {
  calibrateQuantAnalysisThresholds,
  quantAgentServiceEnabled,
  validateQuantAnalyses,
} from "@/lib/quantAgent/client";
import { fetchQuantAgentAnalysisBars, QuantAgentMarketFeedError } from "@/lib/quantAgent/marketFeed";
import {
  listQuantAnalysesAwaitingValidation,
  listQuantAnalysisCalibrationSamples,
  recordQuantAnalysisValidation,
  type QuantAnalysisAwaitingValidation,
} from "@/lib/quantAgent/analysisStore";

/**
 * Quant Agent analysis outcome validation — the sweep that turns the analysis
 * log into a memory.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/services/reflection.py` (the daily reflection
 * worker) driving `analysis_memory.validate_unvalidated_older_than` and then
 * `ai_calibration.calibrate_market`.
 *
 * What changed, and why:
 *
 *  - A CRON ROUTE, NOT A DAEMON THREAD. Upstream starts a background thread at
 *    boot behind `ENABLE_REFLECTION_WORKER` and sleeps
 *    `REFLECTION_WORKER_INTERVAL_SEC` (86400) between passes. This codebase
 *    schedules from `infra/aichart.cron`, so the interval lives there and the
 *    route is overlap-safe via the same distributed lease every other sweep
 *    uses — a second replica skips cleanly instead of double-scoring rows.
 *  - THE CORRECTNESS RULE STAYS IN quant-agent. Upstream computes the ±2%/±5%
 *    verdict inline in the SQL loop. Here web only supplies the two prices;
 *    `/analysis/validate` decides. That keeps every threshold in this engine on
 *    one side of the split, where the tests for them live.
 *  - THE REALISED PRICE IS THE LATEST CLOSE FROM THE ANALYSIS FEED, and it is
 *    recorded on the row alongside the move, so the verdict is auditable
 *    afterwards rather than being a number nobody can reproduce. A symbol whose
 *    feed returns nothing is left unvalidated and retried on the next pass —
 *    never scored against an assumed price.
 *  - CALIBRATION IS A REPORT. Upstream's calibration worker writes the winning
 *    threshold into `qd_ai_calibration`, and the next analysis silently decides
 *    with it. Nothing here feeds the answer back into a live decision: the
 *    thresholds come back in the response and the log for an operator to read,
 *    the same read-only shape `/api/cron/tradability-calibration` already uses.
 *    Auto-tuning a decision boundary on a ±2%/±5% proxy is a product decision
 *    nobody has taken.
 */

export const runtime = "nodejs";
export const maxDuration = 290;

const log = createLogger("cron.quant-analysis-validate");

/** Same single-leader lease shape as the other Quant Agent sweeps. */
const VALIDATE_LOCK_MS = 280_000;

/**
 * `REFLECTION_MIN_AGE_DAYS` upstream. Seven days is what makes the ±2%/±5%
 * verdict mean anything: scored an hour after the call, almost everything is
 * a correct HOLD.
 */
const MIN_AGE_DAYS = 7;
const DAY_MS = 86_400_000;

/** `REFLECTION_VALIDATE_LIMIT` upstream (200). */
const VALIDATE_BATCH_LIMIT = 200;

/** `AI_CALIBRATION_LOOKBACK_DAYS` (30) and the row ceiling for one report. */
const CALIBRATION_LOOKBACK_DAYS = 30;
const CALIBRATION_SAMPLE_LIMIT = 5000;

/** Two bars is enough for a last close; asking for 300 would be wasteful. */
const REALISED_PRICE_BAR_LIMIT = 2;

function priceCacheKey(row: QuantAnalysisAwaitingValidation): string {
  return `${row.market.toLowerCase()}:${row.symbol.toUpperCase()}:${row.interval}`;
}

/**
 * The most recent close for one (market, symbol, interval), or null.
 *
 * `null` is a real answer here — it means "we could not observe what happened",
 * and the caller leaves the row unvalidated rather than inventing a move.
 */
async function fetchRealisedPrice(row: QuantAnalysisAwaitingValidation): Promise<number | null> {
  const feed = await fetchQuantAgentAnalysisBars({
    symbol: row.symbol,
    market: row.market,
    interval: row.interval,
    limit: REALISED_PRICE_BAR_LIMIT,
  });
  const last = feed.bars[feed.bars.length - 1];
  if (!last || !Number.isFinite(last.close) || last.close <= 0) return null;
  return last.close;
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!quantAgentServiceEnabled()) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "QUANT_AGENT_SERVICE_ENABLED is not 1",
    });
  }

  const cutoff = Date.now() - MIN_AGE_DAYS * DAY_MS;
  const pending = await listQuantAnalysesAwaitingValidation({
    olderThanMs: cutoff,
    limit: VALIDATE_BATCH_LIMIT,
  });

  const outcome = await withLock("cron:quant-analysis-validate", VALIDATE_LOCK_MS, async () => {
    // The analyses being scored belong to many users; `owner_user_id` is not
    // part of either analysis request envelope, so this identity only fills
    // the bridge client's tenant-context headers. The candle feed takes no
    // userId at all, exactly as the other Quant Agent crons.
    const userId = await resolveAgentUserId();
    const requestId = randomUUID();
    const context = { userId, requestId };

    let priced = 0;
    let priceMissing = 0;
    let feedFailed = 0;
    const priceCache = new Map<string, number | null>();
    const scorable: { row: QuantAnalysisAwaitingValidation; currentPrice: number }[] = [];

    for (const row of pending) {
      const key = priceCacheKey(row);
      let price = priceCache.get(key);
      if (price === undefined) {
        try {
          price = await fetchRealisedPrice(row);
        } catch (error) {
          price = null;
          feedFailed += 1;
          log.warn("realised price fetch failed", {
            symbol: row.symbol,
            interval: row.interval,
            error:
              error instanceof QuantAgentMarketFeedError || error instanceof Error
                ? error.message
                : String(error),
          });
        }
        priceCache.set(key, price);
      }
      if (price == null) {
        // Left unvalidated on purpose: it will be picked up again next pass,
        // once the feed has something to say about this symbol.
        priceMissing += 1;
        continue;
      }
      priced += 1;
      scorable.push({ row, currentPrice: price });
    }

    let validated = 0;
    let correct = 0;
    let written = 0;
    let serviceSkipped = 0;
    if (scorable.length) {
      const result = await validateQuantAnalyses(
        context,
        scorable.map(({ row, currentPrice }) => ({
          id: row.id,
          decision: row.decision,
          priceAtAnalysis: row.priceAtAnalysis,
          currentPrice,
        })),
      );
      validated = result.stats.validated;
      correct = result.stats.correct;
      serviceSkipped = result.stats.skipped;

      const priceById = new Map(scorable.map(({ row, currentPrice }) => [row.id, currentPrice]));
      for (const verdict of result.results) {
        const realisedPrice = priceById.get(verdict.id);
        if (realisedPrice == null) continue;
        const stored = await recordQuantAnalysisValidation({
          id: verdict.id,
          wasCorrect: verdict.wasCorrect,
          realisedPrice,
          realisedReturnPct: verdict.returnPct,
        });
        // A false here means another replica validated the row first — the
        // `validated_at IS NULL` guard doing its job, not a failure.
        if (stored) written += 1;
      }
    }

    // Read-only tuning report over everything validated so far, this pass
    // included. `applied: false` is the normal answer for a young install and
    // says so with a reason code rather than a silence.
    let calibration: Awaited<ReturnType<typeof calibrateQuantAnalysisThresholds>> | null = null;
    try {
      const samples = await listQuantAnalysisCalibrationSamples({
        sinceMs: Date.now() - CALIBRATION_LOOKBACK_DAYS * DAY_MS,
        limit: CALIBRATION_SAMPLE_LIMIT,
      });
      calibration = await calibrateQuantAnalysisThresholds(context, samples);
      log.info("quant analysis calibration report", {
        applied: calibration.applied,
        reason: calibration.reason,
        sampleCount: calibration.sampleCount,
        buyThreshold: calibration.thresholds.buyThreshold,
        bestAccuracy: calibration.bestAccuracy,
      });
    } catch (error) {
      // The report is a nice-to-have; a failure here must not undo the
      // validation writes that already landed above.
      log.warn("calibration report failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      pending: pending.length,
      priced,
      price_missing: priceMissing,
      feed_failed: feedFailed,
      validated,
      correct,
      incorrect: validated - correct,
      service_skipped: serviceSkipped,
      written,
      calibration,
    };
  });

  if (!outcome.ran) {
    // Another instance already holds the lease — skip cleanly (not an error).
    return NextResponse.json({ skipped: true, reason: "locked" });
  }
  return NextResponse.json({ ok: true, ...outcome.result });
}

// GET is convenient for some schedulers; identical auth + behavior.
export const GET = POST;
