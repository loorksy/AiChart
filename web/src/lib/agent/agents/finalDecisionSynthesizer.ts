/**
 * LLM final-decision synthesizer. The deterministic engine (finalDecisionAgent)
 * stays the SAFETY baseline: it computes the trade skeleton, risk veto, and
 * numeric levels. The LLM then synthesizes the human-facing decision — summary,
 * reasons, public reasoning, drawing advice, and meaningful drawing-candidate
 * selection — grounded in the actual specialist outputs.
 *
 * Hard rules enforced here (the model cannot override them):
 * - Risk veto → WAIT, always, with the real rejection reasons included.
 * - The model can never flip/invent a trade: buy/sell must match the
 *   deterministic proposed action; otherwise the decision is forced to WAIT.
 * - Numeric levels (entry/SL/targets/RR) always come from the deterministic
 *   engine — never from model text.
 * - High news risk caps confidence.
 * - All model text is sanitized: no chain-of-thought ever reaches the user.
 * - Any model/schema failure falls back to the deterministic result.
 */
import { z } from "zod";
import { callLLM, isLLMConfigured } from "@/lib/llm";
import { sanitizePublicText } from "../activity";
import type { AgentRunContext } from "../types";
import type {
  FinalDecisionInput,
  FinalDecisionResult,
} from "./finalDecisionAgent";
import type { DrawingCandidate } from "../drawings/buildDrawingPlan";

const FinalDecisionModelSchema = z.object({
  decision: z.enum(["buy", "sell", "wait"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(10).max(900),
  keyReasons: z.array(z.string()).max(6),
  riskWarnings: z.array(z.string()).max(6),
  publicReasoningSummary: z.array(z.string()).max(5),
  drawingAdvice: z.object({
    shouldDraw: z.boolean(),
    reason: z.string(),
  }),
  selectedCandidateIds: z.array(z.string()).max(8).optional(),
});

export interface SynthesizerOutcome {
  result: FinalDecisionResult;
  usedLLM: boolean;
  selectedCandidateIds?: string[];
  drawingAdvice?: { shouldDraw: boolean; reason: string };
}

export interface SynthesizerDeps {
  /** Injectable model call (tests). Returns raw model text. */
  callModel?: (system: string, user: string) => Promise<string>;
  configured?: boolean;
}

const SYNTH_SYSTEM_PROMPT = `You are the final-decision synthesizer of a chart-connected trading agent.
You receive the REAL outputs of specialist agents (market data quality, structure, liquidity, supply/demand, multi-timeframe, news, risk validation) plus scored drawing candidates.

Write the final user-facing decision in natural Arabic, grounded ONLY in the provided evidence.

Hard rules:
- If riskVeto is true you MUST output decision "wait" and include the provided rejection reasons.
- You may only output "buy" or "sell" if it equals proposedAction; never invent or flip a trade.
- Never invent numbers, levels, or news. Never claim news was checked when newsRisk is "unknown".
- Do not reveal chain-of-thought, hidden reasoning, or scratchpad. publicReasoningSummary is a short list of evidence-based points only.
- drawingAdvice.shouldDraw=false when drawing would mislead (mid-range, weak levels, thin data).
- selectedCandidateIds: pick at most 8 candidate ids worth drawing (only strong, meaningful ones); omit or empty if none.
- summary must be specific to THIS context (symbol, structure, the exact missing condition or the POI) — never a generic sentence.

Respond with ONLY a JSON object, no markdown fences:
{"decision":"buy|sell|wait","confidence":0..1,"summary":"...","keyReasons":[],"riskWarnings":[],"publicReasoningSummary":[],"drawingAdvice":{"shouldDraw":false,"reason":"..."},"selectedCandidateIds":[]}`;

export async function runFinalDecisionSynthesizer(
  ctx: AgentRunContext,
  input: FinalDecisionInput & {
    deterministic: FinalDecisionResult;
    candidates: DrawingCandidate[];
  },
  deps: SynthesizerDeps = {},
): Promise<SynthesizerOutcome> {
  const det = input.deterministic;
  const configured = deps.configured ?? isLLMConfigured();
  if (!configured) {
    return { result: det, usedLLM: false };
  }

  const user = JSON.stringify(buildModelContext(input));
  const callModel =
    deps.callModel ??
    (async (system: string, userMsg: string) => {
      const res = await callLLM({
        system,
        messages: [{ role: "user", content: userMsg }],
        maxTokens: 900,
      });
      return res.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    });

  let parsed: z.infer<typeof FinalDecisionModelSchema>;
  try {
    const raw = await callModel(SYNTH_SYSTEM_PROMPT, user);
    parsed = FinalDecisionModelSchema.parse(JSON.parse(extractJson(raw)));
  } catch {
    // Model or schema failure → deterministic result (safety fallback).
    return { result: det, usedLLM: false };
  }

  return {
    result: applySafetyClamps(parsed, input),
    usedLLM: true,
    selectedCandidateIds: parsed.selectedCandidateIds?.slice(0, 8),
    drawingAdvice: {
      shouldDraw: parsed.drawingAdvice.shouldDraw,
      reason: sanitizePublicText(parsed.drawingAdvice.reason).slice(0, 240),
    },
  };
}

/** Compact, evidence-only context for the model (no raw candles, no secrets). */
function buildModelContext(
  input: FinalDecisionInput & {
    deterministic: FinalDecisionResult;
    candidates: DrawingCandidate[];
  },
): Record<string, unknown> {
  const det = input.deterministic;
  return {
    userMessage: input.userMessage.slice(0, 500),
    symbol: input.market.symbol,
    interval: input.market.interval,
    currentPrice: input.market.currentPrice,
    marketRegime: input.market.marketRegime,
    dataQuality: input.market.dataQuality,
    trend: input.structure?.trend ?? "unknown",
    htfConflict: Boolean(input.mtf?.conflict),
    biases: input.mtf
      ? {
          current: input.mtf.currentBias,
          higher: input.mtf.higherBias,
          daily: input.mtf.dailyBias,
        }
      : null,
    nearestDemand: input.supplyDemand?.nearestDemand ?? null,
    nearestSupply: input.supplyDemand?.nearestSupply ?? null,
    newsRisk: input.news?.newsRisk ?? "unknown",
    newsReason: input.news?.reason ?? "News provider is not configured.",
    riskVeto: input.risk?.veto ?? false,
    riskReasons: [
      ...(input.risk?.validation.reasons ?? []),
      ...(input.risk?.accountWarnings ?? []),
    ],
    riskWarnings: input.risk?.validation.warnings ?? [],
    rr: input.risk?.validation.rr ?? null,
    proposedAction: det.recommendation.action,
    proposedTrade:
      det.recommendation.action !== "wait"
        ? {
            entry: det.recommendation.entry,
            stop_loss: det.recommendation.stop_loss,
            targets: det.recommendation.targets,
          }
        : null,
    drawingCandidates: input.candidates.map((c) => ({
      id: c.id,
      type: c.type,
      price: c.price,
      low: c.low,
      high: c.high,
      computedStrength: c.computedStrength,
    })),
  };
}

/** Enforce the hard safety rules on the model output. */
function applySafetyClamps(
  parsed: z.infer<typeof FinalDecisionModelSchema>,
  input: FinalDecisionInput & { deterministic: FinalDecisionResult },
): FinalDecisionResult {
  const det = input.deterministic;
  const newsRisk = input.news?.newsRisk ?? "unknown";

  // Risk veto is absolute → WAIT with the real rejection reasons preserved.
  const vetoed = det.riskVeto;
  // The model may only confirm the deterministic trade action, never invent one.
  const proposedAction = det.recommendation.action;
  const decision: FinalDecisionResult["decision"] =
    vetoed || parsed.decision === "wait" || parsed.decision !== proposedAction
      ? "wait"
      : parsed.decision;

  let confidence = Math.max(0, Math.min(1, parsed.confidence));
  if (newsRisk === "high") confidence = Math.min(confidence, 0.55);
  if (decision === "wait") confidence = Math.min(confidence, 0.8);

  const clean = (arr: string[], max: number) =>
    arr.map((s) => sanitizePublicText(s).slice(0, 240)).filter(Boolean).slice(0, max);

  const keyReasons = clean(parsed.keyReasons, 6);
  if (vetoed) {
    // Guarantee the actual rejection reasons survive into the final answer.
    for (const r of det.keyReasons) {
      if (!keyReasons.includes(r) && keyReasons.length < 6) keyReasons.push(r);
    }
  }

  return {
    decision,
    confidence,
    summary: sanitizePublicText(parsed.summary).slice(0, 900) || det.summary,
    keyReasons: keyReasons.length ? keyReasons : det.keyReasons,
    riskWarnings: clean(
      [...parsed.riskWarnings, ...det.riskWarnings.filter((w) => !parsed.riskWarnings.includes(w))],
      6,
    ),
    // Numbers only ever come from the deterministic engine.
    recommendation:
      decision === "wait" ? { action: "wait" } : det.recommendation,
    publicReasoningSummary: clean(parsed.publicReasoningSummary, 5).length
      ? clean(parsed.publicReasoningSummary, 5)
      : det.publicReasoningSummary,
    riskVeto: det.riskVeto,
  };
}

function extractJson(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}
