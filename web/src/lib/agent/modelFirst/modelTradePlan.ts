/**
 * Structured model-first trade plan schema (Responses Structured Outputs).
 */
import { z } from "zod";

export const ModelTradePlanSchema = z.object({
  decision: z.enum(["buy", "sell", "wait"]),
  activation: z.enum(["immediate", "conditional", "none"]),
  marketThesis: z.string().min(8).max(1200),
  currentPriceContext: z.string().min(4).max(600),
  timeframeAlignment: z
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
        rationale: z.string().max(240),
      }),
    )
    .max(3)
    .default([]),
  requiredConfirmation: z.string().nullable(),
  pathToEntry: z.string().nullable(),
  alternativeScenario: z.string().min(4).max(800),
  confidence: z.number().min(0).max(1),
  dataTimestamp: z.string().min(4).max(64),
  visionTimeframesUsed: z.array(z.string()).max(8).default([]),
  numericTimeframesUsed: z.array(z.string()).max(8).default([]),
  summary: z.string().min(10).max(900),
  keyReasons: z.array(z.string().max(240)).max(6),
  warnings: z.array(z.string().max(240)).max(6).default([]),
});

export type ModelTradePlan = z.infer<typeof ModelTradePlanSchema>;

export const MODEL_TRADE_PLAN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision",
    "activation",
    "marketThesis",
    "currentPriceContext",
    "timeframeAlignment",
    "entryZone",
    "invalidation",
    "stopLoss",
    "targets",
    "requiredConfirmation",
    "pathToEntry",
    "alternativeScenario",
    "confidence",
    "dataTimestamp",
    "visionTimeframesUsed",
    "numericTimeframesUsed",
    "summary",
    "keyReasons",
    "warnings",
  ],
  properties: {
    decision: { type: "string", enum: ["buy", "sell", "wait"] },
    activation: { type: "string", enum: ["immediate", "conditional", "none"] },
    marketThesis: { type: "string" },
    currentPriceContext: { type: "string" },
    timeframeAlignment: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timeframe", "bias", "evidence"],
        properties: {
          timeframe: { type: "string" },
          bias: { type: "string", enum: ["bullish", "bearish", "neutral", "mixed"] },
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
        required: ["price", "rationale"],
        properties: {
          price: { type: "number" },
          rationale: { type: "string" },
        },
      },
    },
    requiredConfirmation: { type: ["string", "null"] },
    pathToEntry: { type: ["string", "null"] },
    alternativeScenario: { type: "string" },
    confidence: { type: "number" },
    dataTimestamp: { type: "string" },
    visionTimeframesUsed: { type: "array", items: { type: "string" } },
    numericTimeframesUsed: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    keyReasons: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
};

export const MODEL_FIRST_SYSTEM_PROMPT = `You are the sole analytical market authority for AiChart (Forex scalping).

Independently evaluate bullish, bearish, and WAIT scenarios from the neutral live evidence, raw candles, and chart images. Then choose ONE final analytical outcome: BUY, SELL, or WAIT (with activation immediate|conditional|none).

Hard rules:
- You alone decide direction. No prebuilt trade candidate exists. Generate your own entry zone, invalidation, stop, and targets when BUY/SELL.
- WAIT only when you genuinely conclude there is no sufficient edge — never because a candidate engine failed.
- Numeric OHLCV and quote fields are the source of truth for exact prices. Chart images improve structure recognition; do not invent prices from pixels when numbers are provided.
- User-annotated chart context (if present) is operator context, NOT verified market truth.
- Higher timeframes are context only; the primary timeframe is where entry timing is evaluated.
- Never invent news, account balances, or broker facts absent from evidence.
- Do not reveal chain-of-thought. Respond ONLY with the structured JSON schema.
- Risk per Trade is absent on purpose — sizing happens after your decision.`;
