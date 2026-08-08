import { z } from "zod";
import { DESTRUCTIVE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import { zMarket, zSymbol } from "./shapes.js";

/**
 * Every Quant Agent tool description opens with this exact disambiguation —
 * this engine is a completely separate strategy engine from Lonora, with its
 * own isolated store, and must never be confused with create_recommendation
 * or Lonora's analysis/recommendation lifecycle.
 */
const QUANT_AGENT_DISAMBIGUATION =
  "Runs AiChart's separate, independent Quant Agent strategy engine — NOT Lonora's analysis, and NOT create_recommendation. Produces its own buy/sell plan from deterministic strategies (ema_trend_v1, rsi_reversion_v1) and never touches the canonical recommendation lifecycle or any broker account.";

export const QUANT_AGENT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "quant_agent_generate_recommendation",
    domain: "quantAgent",
    description: `${QUANT_AGENT_DISAMBIGUATION} When: the operator explicitly wants a Quant Agent read on a symbol — triggers the engine to evaluate its deterministic strategies against fresh candles and, if one fires, persist a new Quant Agent recommendation in its own isolated store; a "no signal" result is a valid, expected outcome, not an error. Not for recording Lonora's own analysis — that is create_recommendation, a completely separate table, id space, and lifecycle. side-effect: writes a new record to Quant Agent's own store only — never places, modifies, or touches any broker order or account.`,
    inputSchema: {
      symbol: zSymbol.describe("e.g. EURUSD"),
      market: zMarket,
      interval: z.string().min(1).describe("Required timeframe, e.g. 1h, 15m, 4h"),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "quant_agent_list_recommendations",
    domain: "quantAgent",
    description: `${QUANT_AGENT_DISAMBIGUATION} When: browsing or filtering Quant Agent's own recommendation feed by symbol and/or lifecycle state. Not Lonora's recommendation history — that lives in a completely different store; this only ever returns Quant Agent output. read-only. Example: symbol=EURUSD&state=active.`,
    inputSchema: {
      symbol: zSymbol.optional().describe("e.g. EURUSD"),
      state: z
        .enum(["active", "expired", "invalidated", "superseded"])
        .optional()
        .describe("Quant Agent lifecycle state filter"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "quant_agent_get_recommendation",
    domain: "quantAgent",
    description: `${QUANT_AGENT_DISAMBIGUATION} When: fetching one specific Quant Agent recommendation by its id, e.g. to check its current lifecycle state or full plan. Not for Lonora recommendation ids — Quant Agent ids live in a completely separate id space and store. read-only. Example: id=qr_01h....`,
    inputSchema: {
      id: z.string().min(1).describe("Quant Agent recommendation id"),
    },
    annotations: READ_ONLY,
  },
];

export const QUANT_AGENT_TOOL_BY_NAME = Object.fromEntries(
  QUANT_AGENT_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
