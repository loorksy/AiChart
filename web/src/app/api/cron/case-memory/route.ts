import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { withLock } from "@/lib/locks";
import { createLogger } from "@/lib/logger";
import { getFlag, setFlag } from "@/lib/store";
import { listWarehouseSeries } from "@/lib/candles/candleRepository";
import { query } from "@/lib/db";
import {
  INDEXER_VERSION,
  indexSymbolCases,
  resolvePendingCases,
} from "@/lib/marketMemory/caseIndexer";

export const maxDuration = 300;

const log = createLogger("cron:case-memory");
const LEADER_LOCK_MS = 290_000;
const SERIES_CURSOR_FLAG = "case_memory_series_cursor";
/** Series advanced per tick — the walk is CPU-bound on pattern detection. */
const SERIES_PER_TICK = 2;
/** Cases written per series per tick. Both directions count, so this is ~half that many moments. */
const CASES_PER_SERIES = 600;

/**
 * Timeframes worth remembering. Below 15m the moments are too numerous and too
 * noisy to compare usefully; above 4h there are too few in five years to build a
 * sample from.
 */
const INDEXED_INTERVALS = new Set(["15m", "30m", "1h", "4h"]);

function key(series: { symbol: string; interval: string }): string {
  return `${series.symbol}:${series.interval}`;
}

/** Read-only coverage report: how much memory exists, and how much is pending. */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await query<{
    symbol: string;
    interval: string;
    total: number | string;
    resolved: number | string;
    first_case: number | string | null;
    last_case: number | string | null;
  }>(
    `SELECT symbol, interval, COUNT(*) AS total,
            SUM(CASE WHEN outcome IS NULL THEN 0 ELSE 1 END) AS resolved,
            MIN(case_time) AS first_case, MAX(case_time) AS last_case
       FROM market_cases
      WHERE indexer_version = ?
      GROUP BY symbol, interval
      ORDER BY symbol ASC, interval ASC`,
    [INDEXER_VERSION],
  ).catch(() => []);

  return NextResponse.json({
    ok: true,
    indexerVersion: INDEXER_VERSION,
    series: rows.map((row) => ({
      symbol: row.symbol,
      interval: row.interval,
      cases: Number(row.total),
      resolved: Number(row.resolved),
      pending: Number(row.total) - Number(row.resolved),
      firstCase: row.first_case == null ? null : Number(row.first_case),
      lastCase: row.last_case == null ? null : Number(row.last_case),
    })),
  });
}

/**
 * One indexing heartbeat.
 *
 * Round-robins across warehouse series so no single instrument starves, and
 * bounds the work per tick — the memory is built incrementally over many runs,
 * which is also what keeps the outcome columns honest: a case is only resolved
 * once its forward window has genuinely arrived.
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const outcome = await withLock(
    "cron:case-memory",
    LEADER_LOCK_MS,
    async () => {
      const all = (await listWarehouseSeries()).filter((series) =>
        INDEXED_INTERVALS.has(series.interval),
      );
      if (!all.length) {
        return { ok: true, skipped: true, reason: "no indexable warehouse series" };
      }

      const cursor = (await getFlag(SERIES_CURSOR_FLAG)) ?? "";
      const startIndex = Math.max(0, all.findIndex((series) => key(series) === cursor) + 1);
      const batch: Array<{ symbol: string; interval: string }> = [];
      for (let i = 0; i < Math.min(SERIES_PER_TICK, all.length); i++) {
        batch.push(all[(startIndex + i) % all.length]!);
      }

      const results = [];
      for (const series of batch) {
        // Resolve first: cases already indexed and now old enough to have an
        // answer are cheaper than new ones and make the memory usable sooner.
        const resolved = await resolvePendingCases({
          symbol: series.symbol,
          interval: series.interval,
        }).catch((err) => {
          log.warn("resolve failed", { ...series, error: String(err) });
          return 0;
        });
        const indexed = await indexSymbolCases({
          symbol: series.symbol,
          interval: series.interval,
          maxCases: CASES_PER_SERIES,
        }).catch((err) => {
          log.warn("index failed", { ...series, error: String(err) });
          return null;
        });
        results.push({
          ...series,
          resolvedPending: resolved,
          written: indexed?.written ?? 0,
          scanned: indexed?.scanned ?? 0,
        });
      }

      await setFlag(SERIES_CURSOR_FLAG, key(batch[batch.length - 1]!));
      return { ok: true, indexerVersion: INDEXER_VERSION, results };
    },
  );

  if (!outcome.ran) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "another case-memory run holds the lease",
    });
  }
  return NextResponse.json(outcome.result);
}
