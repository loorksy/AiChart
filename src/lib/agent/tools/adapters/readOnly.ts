import { z } from "zod";
import type { AgentToolDefinition } from "../types";

const marketSnapshotInput = z.object({ symbol: z.string().min(3).max(20), timeframe: z.string().min(1).max(8) });
const activeRecommendationInput = z.object({ symbol: z.string().min(3).max(20).optional() });

export function marketSnapshotTool(
  handler: (input: z.infer<typeof marketSnapshotInput>, signal?: AbortSignal) => Promise<Record<string, unknown>>,
): AgentToolDefinition<z.infer<typeof marketSnapshotInput>, Record<string, unknown>> {
  return {
    name: "market_snapshot", version: "1.0.0", description: "Read a fresh synchronized market snapshot.",
    inputSchema: marketSnapshotInput, outputSchema: z.record(z.string(), z.unknown()),
    readOnly: true, repeatable: true, timeoutMs: 12_000, permission: "market.read",
    riskClass: "read", costClass: "medium", requiredProviders: ["market_data"],
    available: ({ providers }) => providers.has("market_data"),
    execute: (context, input) => handler(input, context.signal),
  };
}

export function activeRecommendationReadTool(
  handler: (userId: number, symbol?: string) => Promise<Record<string, unknown> | null>,
): AgentToolDefinition<z.infer<typeof activeRecommendationInput>, Record<string, unknown> | null> {
  return {
    name: "active_recommendation_read", version: "1.0.0", description: "Read the tenant's active recommendation.",
    inputSchema: activeRecommendationInput,
    outputSchema: z.record(z.string(), z.unknown()).nullable(),
    readOnly: true, repeatable: true, timeoutMs: 3_000, permission: "recommendation.read",
    riskClass: "read", costClass: "low",
    available: () => true,
    execute: (context, input) => handler(context.userId, input.symbol),
  };
}
