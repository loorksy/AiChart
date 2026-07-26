/**
 * LLM final-decision authority. Specialist modules supply evidence and
 * price-valid candidates; the model alone chooses BUY, SELL, or WAIT. Numeric
 * levels are then bound to the selected real candidate, and model/schema
 * failure returns a technical no-recommendation state.
 */
import { z } from "zod";
import { callLLM, isLLMConfiguredAsync } from "@/lib/llm";
import { createLogger } from "@/lib/logger";
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
import {
  geometryEvidenceLines,
  summarizeGeometry,
  type GeometrySnapshot,
} from "@/lib/chart/geometry";
import { summarizeChartDrawings } from "../chartDrawingContext";
import { SCALPING_CONTEXT } from "@/lib/productModel";
import { SCALP_GEOMETRY } from "../trading/scalpGeometry";

const log = createLogger("final-decision");

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

/**
 * Why the synthesizer produced no decision. A bare `catch` used to discard
 * this entirely, so every provider outage, quota rejection, and malformed
 * model reply surfaced as the same "try again shortly" message — undebuggable
 * in production.
 */
export type SynthesizerFailureKind =
  | "llm_not_configured"
  | "provider_auth"
  | "provider_rate_limit"
  | "provider_unavailable"
  | "timeout"
  | "network"
  | "empty_response"
  | "invalid_json"
  | "schema_mismatch"
  | "unknown";

export interface SynthesizerFailure {
  kind: SynthesizerFailureKind;
  /** Operator-safe detail (provider text is already user-facing Arabic). */
  detail: string;
  /** True when a retry could plausibly succeed. */
  retryable: boolean;
  /** How many attempts were made before giving up. */
  attempts: number;
}

export interface SynthesizerOutcome {
  result: FinalDecisionResult | null;
  usedLLM: boolean;
  selectedCandidateIds?: string[];
  drawingAdvice?: { shouldDraw: boolean; reason: string };
  /** Present only when `result` is null. */
  failure?: SynthesizerFailure;
}

/** Classify a raw provider/parse error into an actionable failure kind. */
export function classifySynthesizerError(error: unknown): {
  kind: SynthesizerFailureKind;
  retryable: boolean;
  detail: string;
} {
  if (error instanceof z.ZodError) {
    return {
      kind: "schema_mismatch",
      retryable: true,
      detail: `القرار المُعاد لا يطابق العقد: ${error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
        .join("; ")}`,
    };
  }
  if (error instanceof SyntaxError) {
    return {
      kind: "invalid_json",
      retryable: true,
      detail: `تعذّر تحليل رد النموذج كـ JSON: ${error.message}`,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (/\b(401|403)\b/.test(message) || lower.includes("api key") || message.includes("مفتاح")) {
    return { kind: "provider_auth", retryable: false, detail: message };
  }
  if (/\b429\b/.test(message) || lower.includes("rate limit") || lower.includes("quota")) {
    return { kind: "provider_rate_limit", retryable: true, detail: message };
  }
  if (/\b(500|502|503|504)\b/.test(message) || lower.includes("overloaded")) {
    return { kind: "provider_unavailable", retryable: true, detail: message };
  }
  if (lower.includes("abort") || lower.includes("timeout") || lower.includes("timed out")) {
    return { kind: "timeout", retryable: true, detail: message };
  }
  if (lower.includes("fetch failed") || lower.includes("econnreset") || lower.includes("enotfound")) {
    return { kind: "network", retryable: true, detail: message };
  }
  if (message.includes("رد فارغ") || lower.includes("empty")) {
    return { kind: "empty_response", retryable: true, detail: message };
  }
  return { kind: "unknown", retryable: false, detail: message };
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
- A valid directional opinion may exist without executable levels. Do not change BUY/SELL to WAIT merely because levels are unavailable.
- Conditional (pending) candidates require a future retest/confirmation — say so clearly in natural language. Never present a distant pending entry as an immediate trade.
- Never invent numbers, levels, or news. Never claim news was checked when newsRisk is "unknown".
- chartGeometry is deterministic evidence: cite a trendline/channel/pattern by name when it genuinely supports your decision (e.g. "ارتداد من خط الاتجاه الداعم", "مثلث صاعد مكتمل"). Treat status "forming" as WEAKER evidence than "completed"; never trade a forming pattern as if it broke out, and never cite a pattern not present in chartGeometry.
- Do not reveal chain-of-thought, hidden reasoning, scratchpad, POI scores, ATR ratios, or machine ranking labels.
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
    /** Shared-engine geometry: trendlines/channels/patterns with state. */
    geometry?: GeometrySnapshot | null;
    /** Operator locale — the reply language mirrors the operator (SYSTEM.md §2). */
    locale?: "ar" | "en";
    /** Loaded skill guidance (bounded, read-only) appended to the system prompt. */
    skillContextBlock?: string | null;
    /**
     * Realised-outcome lessons for this symbol (item 14). Framed as context to
     * weigh: the model keeps sole authority over BUY/SELL/WAIT, and these lines
     * never override live analysis or any statistical gate.
     */
    lessonsBlock?: string | null;
  },
  deps: SynthesizerDeps = {},
): Promise<SynthesizerOutcome> {
  const configured = deps.configured ?? (await isLLMConfiguredAsync());
  if (!configured) {
    return {
      result: null,
      usedLLM: false,
      failure: {
        kind: "llm_not_configured",
        detail:
          "مفتاح مزوّد الذكاء الاصطناعي غير مُعدّ على الخادم — أضِفه من لوحة المفاتيح.",
        retryable: false,
        attempts: 0,
      },
    };
  }

  const language = input.locale === "en" ? "English" : "Arabic";
  const system = [
    SYNTH_SYSTEM_PROMPT.replace("{{LANGUAGE}}", language),
    input.skillContextBlock?.trim() || null,
    // Realised-outcome context (RELIABILITY_PLAN.md item 14). Evidence the
    // model weighs — never a veto, never a substitute for the live read.
    input.lessonsBlock?.trim() || null,
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
        // Leave headroom for gpt-5 reasoning tokens + the JSON decision payload.
        maxTokens: 2048,
        // The trade decision ALWAYS runs on the deep model (item 15) — never a
        // quick/auxiliary tier, regardless of any default change.
        // The run signal (stage deadline / total budget / client disconnect)
        // tears the call down instead of leaving it running (item 2).
      }, { tier: "deep", signal: ctx.signal });
      return res.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    });

  // ONE automatic retry for transient failures (timeout, network blip, 429/5xx,
  // or a malformed reply the model can usually re-emit correctly). Auth errors
  // and unknown faults fail immediately — retrying them only wastes the budget.
  let parsed: z.infer<typeof FinalDecisionModelSchema> | null = null;
  let failure: SynthesizerFailure | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callModel(system, user);
      parsed = FinalDecisionModelSchema.parse(JSON.parse(extractJson(raw)));
      failure = null;
      break;
    } catch (error) {
      const classified = classifySynthesizerError(error);
      failure = { ...classified, attempts: attempt };
      log.warn("final decision synthesis failed", {
        attempt,
        kind: classified.kind,
        retryable: classified.retryable,
        symbol: input.market.symbol,
        interval: input.market.interval,
        detail: classified.detail.slice(0, 300),
      });
      if (!classified.retryable || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  if (!parsed) {
    return {
      result: null,
      usedLLM: false,
      failure:
        failure ?? {
          kind: "unknown",
          detail: "لم يُنتج نموذج القرار رداً صالحاً.",
          retryable: false,
          attempts: 2,
        },
    };
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
    geometry?: GeometrySnapshot | null;
  },
): Record<string, unknown> {
  const playbook = input.risk?.playbook ?? null;
  const candidate = input.risk?.selectedCandidate ?? null;
  return {
    // Fixed scalping context. Higher-timeframe facts remain evidence only.
    scalpingContext: SCALPING_CONTEXT,
    // --- Trading-brain context (Phase 2) ---
    narrative: input.narrative ?? null,
    // Deterministic chart geometry — trendlines, channels, and named patterns
    // with forming/completed state. EVIDENCE ONLY: it can justify a decision
    // narrative ("bounce off the rising trendline", "ascending triangle
    // completed upward") but never overrides the model's choice and never
    // grants execution authority.
    chartGeometry: input.geometry
      ? {
          summary: summarizeGeometry(input.geometry),
          lines: geometryEvidenceLines(input.geometry).slice(0, 8),
        }
      : null,
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
    selectedCandidate: candidate
      ? {
          id: candidate.id,
          action: candidate.action,
          entryType: candidate.entryType,
          setupType: candidate.setupType,
          rr: candidate.rr,
          netRr: candidate.netRr,
          netRrTp2: candidate.netRrTp2,
          activationClass: candidate.activationClass,
          triggerCondition: candidate.triggerCondition,
          pathSummary: candidate.pathToEntry?.summary,
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
      netRr: tradeCandidate.netRr,
      netRrTp2: tradeCandidate.netRrTp2,
      activationClass: tradeCandidate.activationClass,
      activationDistance: tradeCandidate.activationDistance,
      triggerCondition: tradeCandidate.triggerCondition,
      pathSummary: tradeCandidate.pathToEntry?.summary,
      setupType: tradeCandidate.setupType,
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
      "اتجاه السوق واضح من الدليل، لكن لا توجد مستويات دخول/وقف/هدف قابلة للتنفيذ حالياً.",
    );
  }
  const geometryQuality = selected
    ? Math.min(
        1,
        selected.netRr / SCALP_GEOMETRY.minNetTp1R,
        selected.qualityScore,
      )
    : null;
  const confidenceSemantics =
    decision === "wait"
      ? buildWaitConfidence({
          decisionConfidence: confidence,
          dataQualityScore: input.market.dataQuality.sufficient ? 1 : 0.5,
          setupQuality: null,
          reasons: keyReasons,
        })
      : !selected
        ? buildWaitConfidence({
            decisionConfidence: confidence,
            dataQualityScore: input.market.dataQuality.sufficient ? 1 : 0.5,
            setupQuality: null,
            reasons: keyReasons,
          })
        : buildRecommendationConfidence({
            base: Math.min(confidence, 0.55 + 0.45 * (geometryQuality ?? 0)),
            dataQualityScore: input.market.dataQuality.sufficient ? 1 : 0.5,
            setupQuality: Math.min(
              selected.poi.score.score / 100,
              geometryQuality ?? 0,
            ),
            newsRisk: input.news?.newsRisk ?? "unknown",
            dataSufficientForTrade: input.market.dataQuality.sufficient,
          });
  const displayConfidence =
    typeof confidenceSemantics.displayValue === "number"
      ? confidenceSemantics.displayValue
      : 0;
  const activationClass =
    selected?.activationClass === "immediate" ||
    selected?.activationClass === "conditional"
      ? selected.activationClass
      : undefined;
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
          netRr: selected.netRr,
          netRrTp2: selected.netRrTp2,
          activationClass,
          triggerCondition: selected.triggerCondition,
          invalidationLevel: selected.stop_loss,
          invalidationRule: selected.invalidationReason,
          status:
            activationClass === "immediate" ? "triggered" : "pending_entry",
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
