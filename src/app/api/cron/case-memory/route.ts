import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cronAuth";
import { metrics } from "@/lib/metrics";
import { query } from "@/lib/db";
import { INDEXER_VERSION } from "@/lib/marketMemory/caseIndexer";

/**
 * Read-only coverage report for the historical case memory.
 *
 * There is no more indexing tick here — building a case required a bulk scan
 * of the deleted candle warehouse, which a live-only MetaApi pipeline cannot
 * serve cheaply on a cron cadence. `market_cases` is therefore a frozen
 * dataset now: this endpoint reports what it already holds, but nothing
 * grows it further.
 */
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
