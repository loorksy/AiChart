import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveAgentUserId } from "@/lib/agentAuth";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { generateQuantRecommendation, quantAgentServiceEnabled } from "@/lib/quantAgent/client";
import { fetchQuantAgentBars, QuantAgentMarketFeedError } from "@/lib/quantAgent/marketFeed";

export const runtime = "nodejs";
export const maxDuration = 290;

const log = createLogger("cron.quant-agent-scan");

// Single-leader lease so overlapping cron ticks / multiple replicas never
// double-scan — same shape as recommendation-sweep's lock.
const SCAN_LOCK_MS = 280_000;

/** Fixed, small interval set the two strategies were tuned for (plan §3). */
const SCAN_INTERVALS = ["15m", "1h"] as const;

function watchlistSymbols(): string[] {
  return (process.env.QUANT_AGENT_WATCHLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Scheduled Quant Agent scan — mirrors /api/cron/recommendation-sweep's
 * cron-secret + lease-lock pattern. For each watchlist symbol × fixed
 * interval it pulls fresh candles (the same account-linked pipe every other
 * agent surface uses) and asks the isolated `quant-agent` service to decide.
 * "No signal" ticks are normal and are not counted as failures. This never
 * writes to the canonical `recommendations` table and never calls
 * createCanonicalRecommendation / applyRecommendationRevision — the Quant
 * Agent's output lives entirely inside the isolated service's own database.
 */
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

  const symbols = watchlistSymbols();
  if (!symbols.length) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "QUANT_AGENT_WATCHLIST is empty",
    });
  }

  const outcome = await withLock("cron:quant-agent-scan", SCAN_LOCK_MS, async () => {
    // Candle feed is always the user's own linked MetaTrader account — the
    // watchlist scan borrows the platform's single-operator resolution
    // (AICHART_AGENT_USER_ID, else the first admin), same convention the
    // mass-backtest pipeline uses for its own unattended candle pulls.
    const userId = await resolveAgentUserId();
    let generated = 0;
    let noSignal = 0;
    let failed = 0;

    for (const symbol of symbols) {
      for (const interval of SCAN_INTERVALS) {
        const requestId = randomUUID();
        try {
          const feed = await fetchQuantAgentBars({ userId, symbol, interval });
          if (!feed.bars.length) {
            noSignal += 1;
            continue;
          }
          const recommendation = await generateQuantRecommendation(
            { userId, requestId },
            {
              symbol: feed.symbol,
              market: feed.market,
              interval: feed.interval,
              bars: feed.bars,
            },
          );
          if (recommendation) {
            generated += 1;
          } else {
            noSignal += 1;
          }
        } catch (error) {
          failed += 1;
          const message =
            error instanceof QuantAgentMarketFeedError
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error);
          log.warn("quant-agent scan tick failed", { symbol, interval, requestId, error: message });
        }
      }
    }

    return {
      symbols: symbols.length,
      intervals: SCAN_INTERVALS.length,
      generated,
      no_signal: noSignal,
      failed,
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
