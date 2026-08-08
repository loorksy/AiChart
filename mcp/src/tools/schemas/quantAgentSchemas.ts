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

/**
 * Same disambiguation duty as QUANT_AGENT_DISAMBIGUATION above, but for the
 * Quant Agent *chat* surface specifically — this is a second, independent
 * conversational assistant next to Lonora's chat, with its own persona,
 * session store, and message history (`agent_id='quant_agent'` rows, never
 * mixed with Lonora's `agent_id='lonora'` rows). It explains existing Quant
 * Agent recommendations, can trigger the deterministic recommendation
 * engine, and can propose declarative (data-only, never executable)
 * strategy specifications — it never invents its own trade numbers.
 */
const QUANT_AGENT_CHAT_DISAMBIGUATION =
  "AiChart's separate, independent Quant Agent chat assistant — NOT Lonora's chat: a completely different conversation history, session store, and persona.";

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
  {
    name: "quant_agent_chat_send",
    domain: "quantAgent",
    description: `Sends a message to ${QUANT_AGENT_CHAT_DISAMBIGUATION} Can explain existing Quant Agent recommendations, trigger the deterministic recommendation engine, or propose a new declarative (data-only, never executable) strategy specification that is persisted disabled until the user explicitly enables it. When: continuing or starting a conversation with the Quant Agent assistant specifically — never use this to talk to Lonora, and never use create_recommendation-style tools expecting this to write a canonical recommendation itself. side-effect: appends a user+assistant turn to the Quant Agent chat store and may, as a side effect of the assistant's reply, persist a new disabled strategy proposal — never a live/enabled one, and never a canonical recommendation. Omit chatId to start a new Quant Agent chat session.`,
    inputSchema: {
      chatId: z
        .string()
        .min(1)
        .optional()
        .describe("Existing Quant Agent chat session id; omit to start a new session"),
      message: z.string().min(1).describe("User message to send to the Quant Agent chat assistant"),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "quant_agent_chat_history",
    domain: "quantAgent",
    description: `Reads the message history of a session on ${QUANT_AGENT_CHAT_DISAMBIGUATION} Not Lonora's chat history — that lives in a completely different store; this only ever returns Quant Agent chat turns. read-only. When: reviewing what a Quant Agent chat session has said so far, e.g. before continuing it with quant_agent_chat_send. Example: chatId=qac_01h....`,
    inputSchema: {
      chatId: z.string().min(1).describe("Quant Agent chat session id"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "quant_agent_generate_strategy",
    domain: "quantAgent",
    description: `Generates a new candidate trading strategy for Quant Agent from a natural-language description. The result is a validated, DATA-ONLY declarative specification (never executable code) persisted as DISABLED — it never runs live until the operator explicitly enables it via a separate action. NOT Lonora's analysis; produces no trade recommendation itself, and is not the same conversation as ${QUANT_AGENT_CHAT_DISAMBIGUATION} When: the operator has a strategy idea in plain language and wants Quant Agent to turn it into a validated, disabled strategy definition for later review/enable — not for asking about an existing recommendation, use quant_agent_chat_send or quant_agent_get_recommendation for that. side-effect: writes a new DISABLED row to Quant Agent's own strategy-definitions store only — never executes generated code, never enables itself, and never touches the canonical recommendation lifecycle or any broker account.`,
    inputSchema: {
      description: z
        .string()
        .min(1)
        .describe("Natural-language description of the desired trading strategy"),
    },
    annotations: DESTRUCTIVE,
  },
];

export const QUANT_AGENT_TOOL_BY_NAME = Object.fromEntries(
  QUANT_AGENT_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
