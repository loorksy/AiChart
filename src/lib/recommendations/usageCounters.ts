/**
 * Recommendation usage counters (Phase B).
 *
 * One row per (user, decision path): how many recommendations each brain —
 * the platform agent or an MCP client — has created for this user. The
 * canonical creator increments it inside the create transaction, skipping
 * legacy migrations, so the number states real consumption by path.
 *
 * A counter ONLY. Nothing bills on it and nothing blocks on it; it exists so
 * "how much did each path produce" is a stored fact rather than a guess.
 */
import { query } from "@/lib/db";

export interface RecommendationUsageCounter {
  decisionSource: string;
  count: number;
  updatedAt: number;
}

export async function readRecommendationCounters(
  userId: number,
): Promise<RecommendationUsageCounter[]> {
  const rows = await query<{
    decision_source: string;
    count: number;
    updated_at: number;
  }>(
    `SELECT decision_source, count, updated_at
       FROM recommendation_counters
      WHERE user_id = ?
      ORDER BY decision_source`,
    [userId],
  );
  return rows.map((row) => ({
    decisionSource: row.decision_source,
    count: Number(row.count),
    updatedAt: Number(row.updated_at),
  }));
}
