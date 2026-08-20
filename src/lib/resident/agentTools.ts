/**
 * The resident agent loop's tool set.
 *
 * Registered from the EXISTING analysis capabilities — the specialists, the
 * candle warehouse, the news/macro reader — not re-implemented. Two classes:
 *
 *  - exploration tools (read_candles, candle_ranges): raw store reads so the
 *    model can browse timeframes on its own initiative;
 *  - analysis tools (analyze_timeframe, news_and_macro): the same specialist
 *    code the pipeline runs, exposed per-timeframe so the loop can decide
 *    where to look next.
 *
 * The instrument is the config-pinned symbol carried as a parameter; the
 * tools never accept another one (gold only, by config).
 */
import { z } from "zod";
import { tool, type ToolSet } from "ai";
import { DATA_SYMBOL } from "@/lib/gold";
import {
  goldCandleRange,
  readGoldCandles,
  STORED_TIMEFRAMES,
} from "@/lib/gold/candleStore";
import { listActiveTrackedRecommendations } from "@/lib/recommendations/recommendationStore";
import type { AgentRunContext } from "@/lib/agent/types";

const timeframeSchema = z
  .string()
  .refine((value) => STORED_TIMEFRAMES.includes(value), {
    message: `timeframe must be one of: ${STORED_TIMEFRAMES.join(", ")}`,
  });

/** Minimal orchestrator-context shim for specialists invoked as tools. */
function specialistContext(input: {
  requestId: string;
  userId?: number;
  signal?: AbortSignal;
}): AgentRunContext {
  return {
    requestId: input.requestId,
    userId: input.userId,
    emitActivity: () => {},
    signal: input.signal,
  };
}

export interface ResidentToolsInput {
  userId: number;
  requestId: string;
  signal?: AbortSignal;
}

export function buildResidentTools(input: ResidentToolsInput): ToolSet {
  return {
    read_candles: tool({
      description:
        `Read raw stored ${DATA_SYMBOL} candles for a timeframe (closed bars only, oldest→newest). ` +
        `Use this to browse a timeframe you have not looked at yet.`,
      inputSchema: z.object({
        timeframe: timeframeSchema,
        count: z.number().int().min(10).max(400).default(120),
        /** Read bars at or before this epoch-ms (for stepping further back). */
        beforeMs: z.number().int().positive().optional(),
      }),
      execute: async ({ timeframe, count, beforeMs }) => {
        const candles = await readGoldCandles({
          timeframe,
          toMs: beforeMs,
          limit: count,
        });
        const window = candles.slice(-count);
        return {
          symbol: DATA_SYMBOL,
          timeframe,
          count: window.length,
          candles: window.map((c) => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
        };
      },
    }),

    candle_ranges: tool({
      description:
        "What the candle warehouse holds per timeframe (oldest, newest, count) — check freshness before reading.",
      inputSchema: z.object({}),
      execute: async () => {
        const ranges: Record<
          string,
          { oldest: number | null; newest: number | null; count: number }
        > = {};
        for (const timeframe of STORED_TIMEFRAMES) {
          ranges[timeframe] = await goldCandleRange(timeframe);
        }
        return { symbol: DATA_SYMBOL, ranges };
      },
    }),

    open_recommendations: tool({
      description:
        "The user's currently-open recommendations (entry, stop, targets, state). Read before proposing anything new.",
      inputSchema: z.object({}),
      execute: async () => {
        const open = await listActiveTrackedRecommendations({
          userId: input.userId,
          limit: 20,
        });
        return {
          count: open.length,
          recommendations: open.map((r) => ({
            id: r.id,
            direction: r.direction,
            entry: r.entry,
            stopLoss: r.stopLoss,
            targets: r.targets,
            planType: r.planType ?? null,
            executionState: r.executionState ?? null,
            interval: r.interval,
            expiresAt: r.expiresAt,
          })),
        };
      },
    }),

    analyze_timeframe: tool({
      description:
        "Run the platform's structure, liquidity, and supply/demand specialists on ONE timeframe and return their findings. Use when you decide a timeframe deserves a real look.",
      inputSchema: z.object({ timeframe: timeframeSchema }),
      execute: async ({ timeframe }) => {
        const [{ buildAgentMarketContext }, structure, liquidity, supplyDemand] =
          await Promise.all([
            import("@/lib/agent/marketContext/buildAgentMarketContext"),
            import("@/lib/agent/agents/structureAgent"),
            import("@/lib/agent/agents/liquidityAgent"),
            import("@/lib/agent/agents/supplyDemandAgent"),
          ]);
        const ctx = specialistContext(input);
        const market = await buildAgentMarketContext({
          userId: input.userId,
          symbol: DATA_SYMBOL,
          interval: timeframe,
        });
        const [structureResult, liquidityResult, supplyDemandResult] = await Promise.all([
          structure.runStructureAgent(ctx, market),
          liquidity.runLiquidityAgent(ctx, market),
          supplyDemand.runSupplyDemandAgent(ctx, market),
        ]);
        return {
          symbol: DATA_SYMBOL,
          timeframe,
          currentPrice: market.currentPrice,
          marketOpen: market.marketOpen,
          dataQuality: {
            sufficient: market.dataQuality.sufficient,
            hasCriticalGaps: market.dataQuality.hasCriticalGaps,
          },
          structure: structureResult,
          liquidity: liquidityResult,
          supplyDemand: supplyDemandResult,
        };
      },
    }),

    news_and_macro: tool({
      description:
        "Upcoming economic events and macro posture relevant to gold. ALWAYS check before proposing a plan.",
      inputSchema: z.object({}),
      execute: async () => {
        const { runNewsMacroAgent } = await import("@/lib/agent/agents/newsMacroAgent");
        return runNewsMacroAgent(specialistContext(input), { symbol: DATA_SYMBOL });
      },
    }),
  };
}
