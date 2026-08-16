import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { metrics } from "@/lib/metrics";
import { query } from "@/lib/db";
import { INDEXER_VERSION } from "@/lib/marketMemory/caseIndexer";
import { indexAllGoldCases } from "@/lib/marketMemory/goldCaseIndexer";

/**
 * Index new historical cases, then report coverage.
 *
 * This was a read-only report for a frozen dataset: building a case needs a
 * bulk scan of candles in sliding windows, and the source that served it was
 * deleted. The gold candle store is that source again, so the indexing tick is
 * back — bounded per run, resuming after the newest case already stored, so a
 * nightly pass indexes what the store gained rather than re-walking years.
 *
 * GET still reports coverage either way; `?index=0` skips the tick for a
 * read-only check.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const shouldIndex = url.searchParams.get("index") !== "0";
  const perTimeframe = Number(url.searchParams.get("max"));
  const indexed = shouldIndex
    ? await indexAllGoldCases({
        maxCasesPerTimeframe: Number.isFinite(perTimeframe) ? perTimeframe : undefined,
      }).catch(() => [])
    : [];
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

  // Coverage gauges for the growth dashboard (plan §17).
  let resolvedTotal = 0;
  let pendingTotal = 0;
  for (const row of rows) {
    resolvedTotal += Number(row.resolved);
    pendingTotal += Number(row.total) - Number(row.resolved);
  }
  metrics.caseMemoryRows.set({ state: "resolved" }, resolvedTotal);
  metrics.caseMemoryRows.set({ state: "pending" }, pendingTotal);

  return NextResponse.json({
    ok: true,
    indexerVersion: INDEXER_VERSION,
    indexed,
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
