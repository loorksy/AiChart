/**
 * L2 scenario memory (docs/PLATFORM_AGENT_UPGRADE_PLAN.md Phase 4).
 *
 * The memory stack already has L0 (chat history), L1 (semantic_memories atoms
 * + trade lessons), and L3 (Trading DNA persona). The missing layer was the
 * per-symbol SCENARIO block: "what do this user's outcomes on XAUUSD actually
 * look like" — assembled from realized evidence, not model claims.
 *
 * Storage decision: a scenario block is written INTO the existing semantic
 * memory store under its own category (`scenario_profile`), replacing the
 * previous block for that symbol. That reuses every existing property —
 * bounded recall, safety classification, per-user scoping, the transparency
 * panel, and deletion — instead of minting a parallel memory system. The
 * assembler runs from the daily cron; its inputs are canonical outcome rows,
 * so nothing here can invent a number.
 */
import { query } from "@/lib/db";
import { t } from "@/lib/i18n";
import {
  archiveSemanticMemory,
  insertSemanticMemory,
} from "@/lib/semanticMemory";
import {
  computeCanonicalRecommendationAnalytics,
  type AnalyticsGroup,
} from "@/lib/recommendations/canonical/analytics";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent.scenarioMemory");

export const SCENARIO_MEMORY_CATEGORY = "scenario_profile";

/**
 * Trading-DNA-style evidence gate: below this many completed recommendations a
 * symbol has anecdotes, not a scenario, and writing one would teach the agent
 * noise as if it were the user's record.
 */
export const SCENARIO_MIN_OBSERVATIONS = 5;

/** Cap per user per refresh — the busiest symbols carry the signal. */
const MAX_SYMBOLS_PER_USER = 8;

/**
 * Render one symbol's realized record as a compact Arabic evidence block.
 * Facts only, each traceable to canonical outcome rows; no advice, no
 * prediction — the decision engine weighs it like any other evidence.
 */
/**
 * Below this realized win rate the symbol's record is worth naming as a
 * weakness. A PERCENT, matching AnalyticsGroup.winRate — the repo-wide
 * convention is 0–100, not 0–1.
 */
const WEAK_SCENARIO_WIN_PCT = 35;

export function buildScenarioBlock(group: AnalyticsGroup): string {
  // analytics.group() already returns a percent ((wins / completed) * 100),
  // so this only rounds it. Scaling again turned a 60% record into "6000%".
  // Below the sample-size floor the analytics return null — the block then
  // carries counts only, because a percentage from a handful of trades is a
  // claim the data does not support.
  const winPct = group.winRate == null ? null : Math.round(group.winRate);
  const avgR = Math.round(group.averageR * 100) / 100;
  const counts = {
    total: String(group.total),
    wins: String(group.wins),
    losses: String(group.losses),
  };
  const lines = [
    t("ar", "scenario.block.title", { symbol: group.key }),
    winPct == null
      ? t("ar", "scenario.block.counts_only", counts)
      : t("ar", "scenario.block.with_rate", { ...counts, pct: String(winPct) }),
    t("ar", "scenario.block.avg_r", { r: String(avgR) }),
  ];
  if (
    group.total >= SCENARIO_MIN_OBSERVATIONS &&
    group.winRate != null &&
    group.winRate <= WEAK_SCENARIO_WIN_PCT
  ) {
    lines.push(t("ar", "scenario.block.weak"));
  }
  return lines.join("\n");
}

/**
 * Rebuild the scenario blocks for one user from canonical analytics:
 * archive the previous block per symbol, write the fresh one. Idempotent per
 * day; failures are logged and never propagate into the cron's summary work.
 * Returns how many blocks were written.
 */
export async function refreshUserScenarioMemories(userId: number): Promise<number> {
  const analytics = await computeCanonicalRecommendationAnalytics(userId);
  const eligible = analytics.bySymbol
    .filter((group) => group.total >= SCENARIO_MIN_OBSERVATIONS)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_SYMBOLS_PER_USER);
  if (!eligible.length) return 0;

  let written = 0;
  for (const group of eligible) {
    try {
      // Replace, never accumulate: one live scenario block per symbol.
      const previous = await query<{ id: number }>(
        `SELECT id FROM semantic_memories
          WHERE user_id = ? AND category = ? AND symbol = ? AND archived = 0`,
        [userId, SCENARIO_MEMORY_CATEGORY, group.key],
      );
      for (const row of previous) {
        await archiveSemanticMemory(Number(row.id), userId);
      }
      await insertSemanticMemory({
        userId,
        category: SCENARIO_MEMORY_CATEGORY,
        content: buildScenarioBlock(group),
        source: "scenario_assembler",
        memoryType: "recommendation_outcome",
        // Derived from canonical outcome rows — high confidence by construction.
        confidence: 0.9,
        safetyClassification: "derived_statistics",
        symbol: group.key,
      });
      written += 1;
    } catch (error) {
      log.warn("scenario refresh failed for symbol", {
        userId,
        symbol: group.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return written;
}
