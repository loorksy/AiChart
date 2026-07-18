/**
 * Structured model-first trade plan schema (Responses Structured Outputs).
 * Candidate-free: the model independently chooses direction and levels.
 */
import { z } from "zod";

export const ModelTradePlanSchema = z.object({
  decision: z.enum(["buy", "sell", "wait"]),
  activation: z.enum(["immediate", "conditional", "none"]),
  marketRegime: z.enum(["trend", "range", "breakout", "reversal", "mixed"]),
  marketThesis: z.string().min(8).max(1200),
  primaryTimeframe: z.string().min(1).max(16),
  contextTimeframes: z.array(z.string().max(16)).max(8).default([]),
  timeframeAnalysis: z
    .array(
      z.object({
        timeframe: z.string(),
        bias: z.enum(["bullish", "bearish", "neutral", "mixed"]),
        evidence: z.string().max(400),
      }),
    )
    .max(8)
    .default([]),
  entryZone: z
    .object({
      low: z.number().nullable(),
      high: z.number().nullable(),
      preferred: z.number().nullable(),
    })
    .default({ low: null, high: null, preferred: null }),
  invalidation: z.number().nullable(),
  stopLoss: z.number().nullable(),
  targets: z
    .array(
      z.object({
        price: z.number(),
        reason: z.string().max(240),
      }),
    )
    .max(3)
    .default([]),
  requiredConfirmation: z.string().nullable(),
  pathToEntry: z.string().nullable(),
  alternativeScenario: z.string().min(4).max(800),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(10).max(900),
  keyReasons: z.array(z.string().max(240)).max(6),
  warnings: z.array(z.string().max(240)).max(6).default([]),
  dataTimestamp: z.string().min(4).max(64),
});

export type ModelTradePlan = z.infer<typeof ModelTradePlanSchema>;

export const MODEL_TRADE_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision",
    "activation",
    "marketRegime",
    "marketThesis",
    "primaryTimeframe",
    "contextTimeframes",
    "timeframeAnalysis",
    "entryZone",
    "invalidation",
    "stopLoss",
    "targets",
    "requiredConfirmation",
    "pathToEntry",
    "alternativeScenario",
    "confidence",
    "summary",
    "keyReasons",
    "warnings",
    "dataTimestamp",
  ],
  properties: {
    decision: { type: "string", enum: ["buy", "sell", "wait"] },
    activation: { type: "string", enum: ["immediate", "conditional", "none"] },
    marketRegime: {
      type: "string",
      enum: ["trend", "range", "breakout", "reversal", "mixed"],
    },
    marketThesis: { type: "string" },
    primaryTimeframe: { type: "string" },
    contextTimeframes: { type: "array", items: { type: "string" } },
    timeframeAnalysis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timeframe", "bias", "evidence"],
        properties: {
          timeframe: { type: "string" },
          bias: {
            type: "string",
            enum: ["bullish", "bearish", "neutral", "mixed"],
          },
          evidence: { type: "string" },
        },
      },
    },
    entryZone: {
      type: "object",
      additionalProperties: false,
      required: ["low", "high", "preferred"],
      properties: {
        low: { type: ["number", "null"] },
        high: { type: ["number", "null"] },
        preferred: { type: ["number", "null"] },
      },
    },
    invalidation: { type: ["number", "null"] },
    stopLoss: { type: ["number", "null"] },
    targets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["price", "reason"],
        properties: {
          price: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
    requiredConfirmation: { type: ["string", "null"] },
    pathToEntry: { type: ["string", "null"] },
    alternativeScenario: { type: "string" },
    confidence: { type: "number" },
    summary: { type: "string" },
    keyReasons: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    dataTimestamp: { type: "string" },
  },
};

export const MODEL_FIRST_SYSTEM_PROMPT = `You are the sole analytical authority for AiChart (Forex scalping on MetaTrader).

You receive live numeric market evidence and neutral chart images.
Application code has not generated a trade proposal for you.

Independently analyze market structure, price action, momentum, liquidity, volatility, supply/demand, support/resistance, multi-timeframe context, news evidence, and applicable trading strategies.
Compare bullish, bearish, conditional, and waiting scenarios.
Choose BUY, SELL, or WAIT based solely on your own analysis.

For BUY or SELL, create your own entry zone, preferred entry, invalidation, stop loss, targets, confirmation requirement, path to entry, and alternative scenario.
A conditional trade remains BUY or SELL — use activation=conditional with requiredConfirmation.
WAIT is appropriate only when your own analysis concludes that no sufficient edge currently exists.

Hard rules:
- Higher-timeframe disagreement is evidence, not a veto.
- Unknown or missing news must be disclosed in warnings — never automatically converted to WAIT.
- A pullback entry, pending touch, or future confirmation is NOT WAIT.
- Primary timeframe is evidence.snapshot.primaryTimeframe (user-selected). Context timeframes support the thesis only.
- Numeric OHLCV and quote fields are authoritative for exact prices.
- Never invent news, account balances, leverage, or broker facts absent from evidence.
- Risk per Trade is intentionally absent — sizing happens after your decision.
- Do not reveal chain-of-thought. Return only the required structured result.

When WAIT: activation must be none; levels should normally be null/empty; describe the exact condition that would justify reanalysis.

Activation:
- immediate: price is already in/near your entry zone.
- conditional: direction is clear but entry waits for a defined touch/confirmation.
- none: only with WAIT.`;
