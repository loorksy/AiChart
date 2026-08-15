import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { createLogger } from "@/lib/logger";
import {
  goldCandleRange,
  STORED_TIMEFRAMES,
  syncGoldCandleStore,
} from "@/lib/gold/candleStore";

const log = createLogger("cron.gold-candles");

/**
 * Keep the gold candle store current and dig it deeper.
 *
 * Two motions per run, in this order: catch up to the bars that closed since
 * last time (bounded and fast), then extend history backwards (open-ended).
 * Reversing them would leave the newest bars stale whenever the backfill ran
 * long, and staleness at the front is what a live-adjacent reader notices.
 *
 * Backfill depth is capped per run rather than per night. A cron that tried to
 * pull five years in one pass would hold an OANDA connection for minutes and
 * fail whole; a few pages per run reaches the same depth across a week and
 * resumes from wherever the last one stopped.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pagesParam = Number(new URL(req.url).searchParams.get("pages"));
  const backfillPages = Number.isFinite(pagesParam)
    ? Math.max(1, Math.min(12, Math.floor(pagesParam)))
    : undefined;

  try {
    const report = await syncGoldCandleStore({ backfillPages });
    const coverage = await Promise.all(
      STORED_TIMEFRAMES.map(async (timeframe) => ({
        timeframe,
        ...(await goldCandleRange(timeframe)),
      })),
    );
    return NextResponse.json({ ok: true, ...report, coverage });
  } catch (error) {
    // A sync failure is an operational fact worth reporting with its cause, not
    // a 500 with an opaque body — the next run resumes from whatever landed.
    log.error("gold.store.sync_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "sync failed" },
      { status: 503 },
    );
  }
}
