import { buildChartSnapshotUrl } from "./chartSnapshot";

/**
 * @deprecated Use buildChartSnapshotUrl — kept for backward-compatible imports.
 */
export async function buildChartImageUrl(
  symbol: string,
  interval = "1h",
  _limit = 60,
): Promise<string | null> {
  return buildChartSnapshotUrl({ symbol, interval, limit: _limit });
}
