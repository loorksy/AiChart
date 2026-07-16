/**
 * LLM final-decision authority. Specialist modules supply evidence and
 * price-valid candidates; the model alone chooses BUY, SELL, or WAIT. Numeric
 * levels are then bound to the selected real candidate, and model/schema
 * failure returns a technical no-recommendation state.
 */
import { z } from "zod";
import { callLLM, isLLMConfigured } from "@/lib/llm";
import { sanitizePublicText } from "../activity";
import type { AgentRunContext } from "../types";
import type {
  FinalDecisionInput,
  FinalDecisionResult,
} from "./finalDecisionAgent";
import {
  buildRecommendationConfidence,
  buildWaitConfidence,
} from "../confidenceSemantics";
import type { DrawingCandidate } from "../drawings/buildDrawingPlan";
import type { MarketNarrative } from "../marketContext/buildMarketNarrative";
import { summarizeChartDrawings } from "../chartDrawingContext";
import { SCALPING_CONTEXT } from "@/lib/productModel";

const FinalDecisionModelSchema = z.object({
  decision: z.enum(["buy", "sell", "wait"]),
  selectedTradeCandidateId: z.string().nullable().optional(),
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
  result: FinalDecisionResult | null;
  usedLLM: boolean;
  selectedCandidateIds?: string[];
  drawingAdvice?: { shouldDraw: boolean; reason: string };
}

export interface SynthesizerDeps {
  /** Injectable model call (tests). Returns raw model text. */
  callModel?: (system: string, user: string) => Promise<string>;
  configured?: boolean;
}

const SYNTH_SYSTEM_PROMPT = `You are the sole final decision authority of a chart-connected trading agent.
You receive the REAL outputs of specialist agents (market data quality, structure, liquidity, supply/demand, multi-timeframe, news, risk validation) plus scored drawing candidates.

Write the final user-facing decision in natural {{LANGUAGE}}, grounded ONLY in the provided evidence.

Hard rules:
- Choose BUY, SELL, or WAIT yourself from the specialist evidence and all tradeCandidates.
- Your decision field is the sole market direction authority.
- For BUY/SELL, select a same-direction trade candidate when one truthfully represents usable entry/stop/target levels. If none does, leave selectedTradeCandidateId null; keep your market decision but do not invent levels.
- Never invent numbers, levels, or news. Never claim news was checked when newsRisk is "unknown".
- Do not reveal chain-of-thought, hidden reasoning, or scratchpad. publicReasoningSummary is a short list of evidence-based points only.
- drawingAdvice.shouldDraw=false when drawing would mislead (mid-range, weak levels, thin data).
- selectedCandidateIds: pick at most 8 candidate ids worth drawing (only strong, meaningful ones); omit or empty if none.
- summary must be specific to THIS context (symbol, structure, the exact missing condition or the POI) — never a generic sentence.
- scalpingContext is fixed; higher timeframes are context evidence only.
- Risk per Trade is intentionally absent: sizing occurs after the decision and must never influence BUY/SELL/WAIT.

Respond with ONLY a JSON object, no markdown fences:
{"decision":"buy|sell|wait","selectedTradeCandidateId":"tc-0|null","confidence":0..1,"summary":"...","keyReasons":[],"riskWarnings":[],"publicReasoningSummary":[],"drawingAdvice":{"shouldDraw":false,"reason":"..."},"selectedCandidateIds":[]}`;

export async function runFinalDecisionSynthesizer(
  ctx: AgentRunContext,
  input: FinalDecisionInput & {
    candidates: DrawingCandidate[];
    /** Evidence-based chart story (built from real detector output). */
    narrative?: MarketNarrative | null;
    /** Operator locale — the reply language mirrors the operator (SYSTEM.md §2). */
    locale?: "ar" | "en";
    /** Loaded skill guidance (bounded, read-only) appended to the system prompt. */
    skillContextBlock?: string | null;
  },
  deps: SynthesizerDeps = {},
): Promise<SynthesizerOutcome> {
  const configured = deps.configured ?? isLLMConfigured();
  if (!configured) {
    return { result: null, usedLLM: false };
  }

  const language = input.locale === "en" ? "English" : "Arabic";
  const system = [
    SYNTH_SYSTEM_PROMPT.replace("{{LANGUAGE}}", language),
    input.skillContextBlock?.trim() || null,
  ]
    .filter(Boolean)
    .join("\n\n");
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
    const raw = await callModel(system, user);
    parsed = FinalDecisionModelSchema.parse(JSON.parse(extractJson(raw)));
  } catch {
    return { result: null, usedLLM: false };
  }

  return {
    result: applyModelDecision(parsed, input),
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
    candidates: DrawingCandidate[];
    narrative?: MarketNarrative | null;
  },
): Record<string, unknown> {
  const playbook = input.risk?.playbook ?? null;
  const candidate = input.risk?.selectedCandidate ?? null;
  return {
    // Fixed scalping context. Higher-timeframe facts remain evidence only.
    scalpingContext: SCALPING_CONTEXT,
    // --- Trading-brain context (Phase 2) ---
    narrative: input.narrative ?? null,
    playbook: playbook
      ? {
          warnings: playbook.warnings,
          checklist: playbook.checklist.map((i) => ({
            id: i.id,
            status: i.status,
            reason: i.reason,
          })),
        }
      : null,
    selectedCandidate: candidate ? { id: candidate.id,
          action: candidate.action,
          entryType: candidate.entryType,
          setupType: candidate.setupType,
          rr: candidate.rr,
          poiGrade: candidate.poi.score.grade,
          poiScore: candidate.poi.score.score,
          evidence: candidate.evidence,
          warnings: candidate.warnings,
          invalidationReason: candidate.invalidationReason,
        }
      : null,
    tradeCandidates: (input.risk?.candidatesResult.candidates ?? []).map((tradeCandidate) => ({
      id: tradeCandidate.id,
      action: tradeCandidate.action,
      entry: tradeCandidate.entry,
      entryType: tradeCandidate.entryType,
      stop_loss: tradeCandidate.stop_loss,
      targets: tradeCandidate.targets,
      rr: tradeCandidate.rr,
      setupType: tradeCandidate.setupType,
      poiGrade: tradeCandidate.poi.score.grade,
      poiScore: tradeCandidate.poi.score.score,
      evidence: tradeCandidate.evidence,
      warnings: tradeCandidate.warnings,
      invalidationReason: tradeCandidate.invalidationReason,
    })),
    rejectedCandidateReasons:
      input.risk?.candidatesResult?.rejectedReasons.slice(0, 6) ?? [],
    hasReversalEvidence:
      input.risk?.candidatesResult?.hasReversalEvidence ?? false,
    rangePosition: input.risk?.rangePosition?.label ?? "unknown",
    newsEvents:
      input.news?.upcomingEvents.slice(0, 8).map((e) => ({
        title: e.title,
        time: e.time,
        impact: e.impact,
        currency: e.currency,
      })) ?? [],
    userMessage: input.userMessage.slice(0, 500),
    chartDrawings: summarizeChartDrawings(
      input.chartDrawings,
      input.market.currentPrice,
    ),
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
    evidenceWarnings: [
      ...(input.risk?.validation.warnings ?? []),
      ...(input.risk?.accountWarnings ?? []),
    ],
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

/** Keep the model's chosen action authoritative and bind only real matching levels. */
function applyModelDecision(
  parsed: z.infer<typeof FinalDecisionModelSchema>,
  input: FinalDecisionInput,
): FinalDecisionResult {
  const confidence = Math.max(0, Math.min(1, parsed.confidence));
  const clean = (arr: string[], max: number) =>
    arr.map((s) => sanitizePublicText(s).slice(0, 240)).filter(Boolean).slice(0, max);
  const keyReasons = clean(parsed.keyReasons, 6);
  const riskWarnings = clean(parsed.riskWarnings, 6);
  const selected = parsed.decision === "wait"
    ? null
    : (input.risk?.candidatesResult.candidates ?? []).find(
        (candidate) =>
          candidate.id === parsed.selectedTradeCandidateId &&
          candidate.action === parsed.decision,
      ) ?? null;
  const decision: FinalDecisionResult["decision"] = parsed.decision;
  if (!selected && parsed.decision !== "wait") {
    riskWarnings.unshift(
      "قرار السوق لا يملك مستويات دخول/وقف/هدف موثقة حالياً؛ لا يمكن تجهيزه للتنفيذ.",
    );
  }
  const confidenceSemantics =
    decision === "wait"
      ? buildWaitConfidence({
          decisionConfidence: confidence,
          dataQualityScore: input.market.dataQuality.sufficient ? 1 : 0.5,
          setupQuality: null,
          reasons: keyReasons,
        })
      : buildRecommendationConfidence({
          base: confidence,
          dataQualityScore: input.market.dataQuality.sufficient ? 1 : 0.5,
          setupQuality: selected ? selected.poi.score.score / 100 : null,
          newsRisk: input.news?.newsRisk ?? "unknown",
          dataSufficientForTrade: input.market.dataQuality.sufficient,
        });
  const displayConfidence =
    typeof confidenceSemantics.displayValue === "number"
      ? confidenceSemantics.displayValue
      : 0;
  return {
    decision,
    confidence: displayConfidence,
    confidenceSemantics,
    summary: sanitizePublicText(parsed.summary).slice(0, 900),
    keyReasons,
    riskWarnings: riskWarnings.slice(0, 6),
    recommendation: selected
      ? {
          action: selected.action,
          entry: selected.entry,
          entryType: selected.entryType,
          stop_loss: selected.stop_loss,
          targets: selected.targets,
          take_profit: selected.targets[0],
          rr: selected.rr,
        }
      : { action: decision },
    publicReasoningSummary: clean(parsed.publicReasoningSummary, 5),
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
