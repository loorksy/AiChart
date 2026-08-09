/**
 * The decision engine (docs/UNIFIED_AGENT_IMPLEMENTATION_PLAN.md §4-b).
 *
 * It is the ONLY component that turns evidence into a trading decision. It
 * takes the frozen evidence bundle, and returns the three layers — direction,
 * plan type, execution state — plus the plan, the evidence card, and the
 * decision trace. It holds no persistent state and reads nothing outside the
 * bundle while deciding.
 *
 * A successful analysis always yields a direction. Levels are bound to a real
 * candidate, or composed from the evidence level menu and verified against it;
 * numbers that match neither are refused whole rather than repaired. Model or
 * data failure is an operational blocker with a name, never a decision to wait.
 */
import { z } from "zod";
import { callLLM, isLLMConfiguredAsync } from "@/lib/llm";
import type { ContentBlock } from "@/lib/anthropic";
import { createLogger } from "@/lib/logger";
import { sanitizePublicText } from "../activity";
import type { AgentRunContext } from "../types";
import type {
  FinalDecisionInput,
  FinalDecisionResult,
} from "./finalDecisionAgent";
import {
  buildDirectionalConfidence,
  buildRecommendationConfidence,
} from "../confidenceSemantics";
import { buildEvidenceDimensions } from "../evidenceDimensions";
import {
  activationRuleSchema,
  describeActivationRule,
  explainActivationRuleIncoherence,
  normalizeActivationRule,
} from "@/lib/recommendations/activationRule";
import {
  buildEvidenceLevels,
  deriveExecutionState,
  levelTolerance,
  resolvePlanLevels,
  type PlanType,
} from "../trading/tradePlan";
import type { AgentRecommendation, DecisionTrace } from "../types";
import type { DrawingCandidate } from "../drawings/buildDrawingPlan";
import type { MarketNarrative } from "../marketContext/buildMarketNarrative";
import {
  geometryEvidenceLines,
  summarizeGeometry,
  type GeometrySnapshot,
} from "@/lib/chart/geometry";
import { breakLevelOf, offersAnticipatoryEntry } from "@/lib/chart/geometry/patternStage";
import { summarizeChartDrawings } from "../chartDrawingContext";
import { SCALPING_CONTEXT } from "@/lib/productModel";
import { SCALP_GEOMETRY } from "../trading/scalpGeometry";
import type { StatisticalSupport } from "@/lib/strategies/supportSummary";
import { serializeCostEvidence } from "../marketContext/costEvidence";
import { FEATURES } from "../featureFlags";
import { metrics } from "@/lib/metrics";
import type { HistoricalCaseEvidence } from "@/lib/marketMemory/caseQuery";
import type { MacroRegimeBlock } from "../macro/fredProvider";
import type { CotPositioning } from "../macro/cotProvider";

const log = createLogger("final-decision");

/** Frames the model may request in the second round. */
const EXTRA_FRAME_WHITELIST = new Set(["5m", "15m", "30m", "1h", "4h", "1d"]);

/**
 * Validate an extra-frame request: whitelisted, and not already attached.
 * Anything else returns null and the request is refused rather than obeyed.
 */
function normalizeExtraFrameRequest(
  requested: string | null | undefined,
  attached: readonly VisualSnapshot[],
): string | null {
  if (!requested) return null;
  const frame = requested.trim().toLowerCase();
  if (!EXTRA_FRAME_WHITELIST.has(frame)) return null;
  if (attached.some((s) => s.timeframe.toLowerCase() === frame)) return null;
  return frame;
}

/** The default second-round model call, with the extra frame attached. */
async function callModelWithBlocks(
  system: string,
  userMsg: string,
  blocks: ContentBlock[],
  ctx: AgentRunContext,
): Promise<string> {
  const res = await callLLM(
    {
      system,
      messages: [{ role: "user", content: [{ type: "text", text: userMsg }, ...blocks] }],
      maxTokens: 3072,
    },
    { tier: "deep", signal: ctx.signal },
  );
  return res.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

const PlanLevelsSchema = z.object({
  entryLow: z.number().positive().optional(),
  entryHigh: z.number().positive().optional(),
  preferredEntry: z.number().positive(),
  stopLoss: z.number().positive(),
  targets: z.array(z.number().positive()).min(1).max(3),
});

const DecisionTraceSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        scenario: z.string().max(240),
        supporting: z.array(z.string().max(160)).max(4),
        opposing: z.array(z.string().max(160)).max(4),
      }),
    )
    .max(3),
  chosenBecause: z.string().max(400),
  planTypeBecause: z.string().max(400),
});

const FinalDecisionModelSchema = z.object({
  /** Layer 1 — always a side on a successful analysis. */
  direction: z.enum(["buy", "sell"]),
  /** Layer 2 — how the plan is entered. */
  planType: z.enum(["immediate", "anticipatory", "conditional"]),
  selectedTradeCandidateId: z.string().nullable().optional(),
  /** Levels composed from the evidence menu when no candidate fits. */
  proposedLevels: PlanLevelsSchema.nullable().optional(),
  /** Which timeframe drove the decision, gave context, and timed the entry. */
  timeframeRoles: z
    .object({
      lead: z.string().max(16),
      context: z.string().max(16).nullable().optional(),
      timing: z.string().max(16).nullable().optional(),
    })
    .optional(),
  activationCondition: z.string().max(400).nullable().optional(),
  /**
   * The machine-checkable form of `activationCondition`. Emitted by the model
   * rather than parsed out of its sentence: deriving a rule from free text
   * would be guessing at what the plan meant, and a guessed trigger is how a
   * plan ends up filling on something it never asked for.
   */
  activationRule: activationRuleSchema.nullable().optional(),
  invalidationRule: z.string().max(400),
  alternativeScenario: z.string().max(400),
  validityCandles: z.number().int().min(1).max(96),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(10).max(900),
  keyReasons: z.array(z.string()).max(6),
  riskWarnings: z.array(z.string()).max(6),
  publicReasoningSummary: z.array(z.string()).max(5),
  decisionTrace: DecisionTraceSchema,
  drawingAdvice: z.object({
    shouldDraw: z.boolean(),
    reason: z.string(),
  }),
  selectedCandidateIds: z.array(z.string()).max(8).optional(),
  /**
   * One specific additional timeframe the model wants to SEE before finalising —
   * the plan's "extra frame on demand" (§10 E). Null when the attached views
   * suffice, which is the normal answer. Honoured at most once, from a
   * whitelist, on a separate budget; a failed capture keeps this first decision.
   */
  requestExtraTimeframe: z.string().max(8).nullable().optional(),
}).superRefine((value, ctx) => {
  // Cross-field coherence, enforced where the retry loop can feed the exact
  // violation back to the model. The persist-time plan contract enforces the
  // same facts, but a violation there throws AFTER the analysis — the operator
  // sees a failure instead of a corrected answer.
  if (value.planType !== "immediate") {
    if (!value.activationRule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activationRule"],
        message: `a ${value.planType} plan must carry the machine-checkable activationRule for its activationCondition — without it the tracker would fill the plan on a bare entry touch`,
      });
    }
    if (!value.activationCondition?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activationCondition"],
        message: `a ${value.planType} plan must state its activation condition in plain language`,
      });
    }
  }
  // rejection_confirmed.direction is the side the candle must CLOSE on. A
  // bearish rejection that arms a SELL closes back BELOW the level; a bullish
  // rejection arming a BUY closes back ABOVE. The inverted combination is a
  // rule the market can only satisfy by moving against the plan — permanently
  // unsatisfiable in practice, which is how a met condition never activates.
  const leaves =
    value.activationRule?.kind === "composite"
      ? value.activationRule.rules
      : value.activationRule
        ? [value.activationRule]
        : [];
  for (const leaf of leaves) {
    if (leaf.kind !== "rejection_confirmed") continue;
    const required = value.direction === "sell" ? "below" : "above";
    if (leaf.direction !== required) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activationRule"],
        message: `rejection_confirmed.direction is the side the candle must CLOSE on: a rejection arming a ${value.direction} must use direction:"${required}"`,
      });
    }
  }
});

export type FinalDecisionModelOutput = z.infer<typeof FinalDecisionModelSchema>;

/** One captured chart plus the numbers for the same timeframe. */
export interface VisualSnapshot {
  timeframe: string;
  imageBase64: string;
  numericContext?: unknown;
}

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
  | "provider_bad_request"
  | "provider_billing"
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
  /**
   * The immutable, complete input the decision engine actually read.
   *
   * Re-evaluation persists this object verbatim. Keeping it on the outcome
   * prevents callers from reconstructing a smaller, subtly different bundle
   * after the model has already decided.
   */
  evidenceSnapshot?: Record<string, unknown>;
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
  // Out of credit also arrives as 429 — but it is permanent until someone
  // tops up the account, so it must not be reported as a transient busy signal.
  if (
    lower.includes("no credits") ||
    lower.includes("insufficient_quota") ||
    lower.includes("insufficient quota") ||
    lower.includes("exceeded your current quota") ||
    lower.includes("billing")
  ) {
    return { kind: "provider_billing", retryable: false, detail: message };
  }
  if (/\b429\b/.test(message) || lower.includes("rate limit") || lower.includes("quota")) {
    return { kind: "provider_rate_limit", retryable: true, detail: message };
  }
  // A 4xx from the provider is a request/configuration problem (bad model id,
  // unsupported parameter, context overflow) — surfacing it as "unknown" hid
  // the one thing the operator needed to hear: fix the model settings.
  if (
    /\b(400|404|409|413|422)\b/.test(message) ||
    lower.includes("bad request") ||
    lower.includes("does not exist") ||
    lower.includes("context length") ||
    lower.includes("unsupported parameter")
  ) {
    return { kind: "provider_bad_request", retryable: false, detail: message };
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
  /**
   * Capture ONE extra timeframe for the second round. Injectable for tests;
   * defaults to the same visual-evidence collector the first round used.
   */
  captureExtraFrame?: (timeframe: string) => Promise<VisualSnapshot | null>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function frozenEvidenceSnapshot(
  input: Parameters<typeof buildModelContext>[0] & {
    locale?: "ar" | "en";
    skillContextBlock?: string | null;
    lessonsBlock?: string | null;
    visualSnapshots?: VisualSnapshot[] | null;
  },
): Record<string, unknown> {
  // JSON cloning deliberately removes undefined values, exactly as the model
  // serialization does, and detaches the snapshot from mutable pipeline data.
  const detached = JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      modelContext: buildModelContext(input),
      visualSnapshots: input.visualSnapshots ?? [],
      locale: input.locale ?? "ar",
      skillContextBlock: input.skillContextBlock ?? null,
      lessonsBlock: input.lessonsBlock ?? null,
    }),
  ) as Record<string, unknown>;
  return deepFreeze(detached);
}

const SYNTH_SYSTEM_PROMPT = `You are the decision engine of a chart-connected Forex scalping agent — the only component that turns evidence into a decision.
You receive the REAL outputs of the evidence pipeline (market data quality, structure, liquidity, supply/demand, multi-timeframe, chart geometry, news, cost-aware candidates) plus a menu of real price levels.

Write the final user-facing decision in natural {{LANGUAGE}}, grounded ONLY in the provided evidence.

## How to think (follow this order)
1. Read the evidence and form 2–3 competing scenarios for where price goes next.
2. Test each against the evidence — what supports it, what argues against it.
3. Pick ONE as your main scenario and keep the runner-up as the alternative.
4. Build the plan: where to enter, where the idea dies, where to take profit, how long it stays valid.
5. Re-check the plan against the costs and the calendar before you answer.

## The three layers — never mix them
- direction: "buy" or "sell". A successful analysis ALWAYS produces one. There is no wait, no neutral, no "unclear".
- planType: "immediate" (price is in a valid entry area now), "anticipatory" (entering while the structure is still forming — from a triangle's rising lows, a second rejection before the neckline, a range edge, after a liquidity sweep; higher risk, say so), or "conditional" (the entry waits for a stated trigger: a close beyond a level, a rejection from a zone, a better price, or the first move after a release).
- The direction is mandatory; an entry at the current price is NOT. If price is a poor entry, or the move does not pay for its spread and slippage, keep the direction and make the plan conditional at the price or condition that WOULD make it worth taking. Never invent a weak entry, and never stretch a target or tighten a stop to make the numbers look acceptable.
- A conditional plan is NOT a license for a distant level. An actionable entry is one the market can realistically reach within validityCandles — near the current price relative to recent volatility. The platform grades every plan's reachability and REFUSES entries too far from the market; when your best level is far away, keep the direction, name the level as what you are WATCHING in the summary and alternativeScenario, and do not dress it as an entry.

## Choosing the plan type — the decision procedure
Ask, in order:
1. Is the current price INSIDE a validated POI/zone for my direction, with acceptable net cost? → immediate. Waiting for a "better price" you do not need is how good entries are missed.
2. Is price NEAR the zone and approaching it, with a forming structure whose boundary is itself a defensible entry? → anticipatory, and say the structure may still fail.
3. Otherwise → conditional, and the trigger must be an event that CONFIRMS your idea, not one that merely reaches a number. Rank triggers by evidence value: rejection/retest at a real POI > candle close beyond a level > bare touch. Use price_touch only when a touch genuinely completes the setup (e.g. a limit at the far edge of a fresh zone).
- The trigger must be REACHABLE and PLAUSIBLE from where price is NOW: a "wait for pullback to X" needs X on the correct side of the current price and within recent swing distance; a "close beyond Y" needs Y not yet closed beyond. The platform re-checks this against the live price and rejects contradictions — a condition already satisfied at issue time is not a condition, and a condition on the wrong side of price grades a different event than your sentence describes.
- Example (correct): price 4330, sell idea, POI 4345–4350 above. Conditional sell — rejection_confirmed at 4348 with direction:"below": price must RISE into the zone, get rejected, close back under. If instead price were already at 4355, the same rule is WRONG (price is beyond the level); the honest plan is a close-below trigger or a different POI.
- Example (wrong): price 4330, sell idea, activationRule candle_close_below 4340. Price is already below 4340 — the "condition" fires on the next candle. That is an immediate plan hiding behind a conditional label.

## Choosing the entry LEVEL
- Enter at the EDGE of the POI/zone nearest the current price plus a spread margin — not the middle of the zone and not its far side. The middle "feels safer" but gives up half the zone's R for no evidence.
- Respect the spread: on instruments with a wide spread (gold, exotics), an entry closer than ~2 spreads to the trigger level will fill on noise. Place the entry past the trigger by a real margin.
- The stop goes past the structural invalidation with a volatility buffer (as stated below); the entry choice must never be moved closer to "improve" the R ratio — the R ratio reports the trade, it does not design it.

## The charts
- When chart images are attached, each one arrives immediately after a label naming its timeframe and carrying that timeframe's numbers. Read the picture and the numbers together, and bind each chart to the timeframe it belongs to.
- Images confirm SHAPE — a rejection, a gap, a formation, where a structure sits. Every precise level you quote must come from the numeric evidence, never estimated off the pixels.
- Say which timeframe LEADS this decision, which provides CONTEXT, and which times the ENTRY, in timeframeRoles. When the timeframes disagree, that assignment IS the resolution — never let disagreement remove the direction.
- If a timeframe is missing from the attachments, say you did not have that view rather than implying full coverage.

## Levels
- Prefer a same-direction tradeCandidate: set selectedTradeCandidateId and leave proposedLevels null. Its geometry is already validated.
- If no candidate fits your plan (e.g. you want a better price), set selectedTradeCandidateId null and fill proposedLevels using ONLY prices that appear in evidenceLevels. Any price not on that menu is rejected and your plan loses its numbers — so quote the menu, never a number you computed yourself.
- Geometry must hold: buy → stop < entry < targets; sell → targets < entry < stop.
- A candidate carrying a weak-net-R warning is still a real option: take it and say the return is thin, or plan a better price instead. Do not silently ignore it.
- SPAN CONTRACT (product rule): a plan spans a REAL swing of the analyzed timeframe — TP1 sits several ATR from the entry (roughly 30 candles of travel), never the first shelf a few points away. Candidates already respect this; when you propose your own levels, hold yourself to the same floor.
- TARGETS: always at least TWO. A third target when the structure genuinely offers one beyond TP2 — never invented.
- STOP: the structural invalidation level plus a real volatility buffer BEYOND it — never exactly ON the level (a stop at 4393.52 belongs at ≈4401.79 on a gold intraday plan). Candidates carry this buffer already (structuralStop vs stop_loss); when proposing levels, pick the evidence level past the invalidation, not the invalidation itself. Never tighten a stop to flatter the R ratio.

## Evidence, not gates
- Structure, liquidity, patterns, historical cases, backtests, costs, and news STRENGTHEN or WEAKEN a plan. None of them decides whether a plan exists.
- Ranging or mid-range markets have plans: range edges, liquidity sweeps, the expected break, the false break. Never answer "unclear" for a range.
- Conflicting timeframes: say which timeframe leads the decision, which is context, which times the entry. Conflict never removes the direction.
- chartGeometry is deterministic evidence — cite a trendline/channel/pattern by name when it genuinely supports you. A "forming" pattern is weaker evidence that it will COMPLETE, but its boundary can be an excellent entry: that is what anticipatory means.
- Never force price into a named pattern that does not fit. Describe the structure you actually see and call it hybrid or unclassified; that is a valid basis for a plan.
- historicalCases carries what followed structurally similar moments, for BOTH directions, measured before you chose one. Read both sides. A memory leaning the other way is a real argument to weigh, not a veto — and when both sides are thin the memory simply has nothing to say.
- Quote a historical rate ONLY when historicalCases gives you one. A null hitRate means the sample is too small for a percentage: cite the count, or say there is no comparable history. Never turn "3 of 4 similar cases worked" into a number.
- Never claim statistical support you were not given, and never invent a win rate, a historical count, news, or any number.
- statisticalSupport is your validated arsenal for THIS symbol and timeframe: its level (strong/moderate/weak/unavailable), the best deployment's calibrated confidence, and a deployments list of matching backtested strategies. When level is not "unavailable", weigh it and CITE it (strategy, calibrated confidence, live sample) in your reasoning; when a listed strategy's conditions match your setup, say so. When it is "unavailable", say plainly the plan rests on direct analysis. It informs confidence — never the existence of the direction.
- executionCost is the cost evidence: whenever executionCost.source is anything other than "unavailable" (observed_quote, live_cost_profile, session_profile, static_fallback), cite its spread figure (observed_spread_pips, naming the source when it is a fallback) in your cost reasoning — never say the spread is unavailable; you may only claim the spread/slippage is unavailable when executionCost.source === "unavailable".
- Never claim news was checked when newsRisk is "unknown".
- macroRegime (Fed policy rate/trend, inflation, curve) and cotPositioning (weekly speculative positioning, with extremes flagged) are SLOW context: they strengthen or weaken a plan and its confidence, never its existence or direction. An extreme positioning reading is a crowding warning, not a signal. Never claim macro or positioning was checked when its block is absent.

## Output rules
- invalidationRule: what specifically kills this idea (a close beyond a level), in plain language.
- activationCondition: required for conditional and anticipatory plans — the exact event that turns the plan on. null for immediate.
- activationRule: the SAME condition as data, so the tracker can check it. Required whenever activationCondition is set; null for immediate. Pick the kind that matches what you actually wrote — price_touch ONLY if a bare touch really is enough. candle_close_above/below need level + timeframe (and closes when you demand more than one). breakout_confirmed needs level + direction. retest_confirmed needs the retestZone price band you expect the pullback into. rejection_confirmed means a wick through the level and a close back — its "direction" is the side the candle must CLOSE on: a bearish rejection of resistance that arms a SELL is direction:"below"; a bullish rejection of support that arms a BUY is direction:"above". Use composite {operator:"all"|"any"} for two conditions. Never state a rule looser than your sentence: if you wrote "close above", do not emit price_touch. A rule whose direction contradicts your trade side can never be satisfied — the plan would wait forever.
- validityCandles: how many candles of THIS timeframe the plan stays meaningful.
- alternativeScenario: the runner-up scenario and what would make you switch to it.
- decisionTrace: the scenarios you weighed, what supported and opposed each, why this one won, and why this plan type. Operator-readable, no internal jargon.
- Do not reveal chain-of-thought, scratchpad, POI scores, ATR ratios, or machine ranking labels.
- drawingAdvice.shouldDraw=false only when drawing would genuinely mislead (no usable levels, thin data).
- selectedCandidateIds: at most 8 candidate ids worth drawing; omit or empty if none.
- requestExtraTimeframe: null almost always. Set it (one of: 5m, 15m, 30m, 1h, 4h, 1d) ONLY when a specific missing view would genuinely change your read — you get at most one extra frame, once, and your current answer stands if the capture fails. Never request a frame you were already shown.
- summary must be specific to THIS context (symbol, structure, the exact trigger or zone) — never a generic sentence.
- scalpingContext is fixed; higher timeframes are context evidence only.
- Risk per Trade is intentionally absent: sizing happens after the decision and must never influence direction or plan.

Respond with ONLY a JSON object, no markdown fences:
{"direction":"buy|sell","planType":"immediate|anticipatory|conditional","selectedTradeCandidateId":"tc-0|null","proposedLevels":null,"timeframeRoles":{"lead":"15m","context":"4h","timing":"5m"},"activationCondition":"...|null","activationRule":{"kind":"candle_close_above","level":0,"timeframe":"15m"}|null,"invalidationRule":"...","alternativeScenario":"...","validityCandles":6,"confidence":0..1,"summary":"...","keyReasons":[],"riskWarnings":[],"publicReasoningSummary":[],"decisionTrace":{"hypotheses":[{"scenario":"...","supporting":[],"opposing":[]}],"chosenBecause":"...","planTypeBecause":"..."},"drawingAdvice":{"shouldDraw":true,"reason":"..."},"selectedCandidateIds":[]}`;

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
     * weigh: the model keeps sole authority over the direction, and these lines
     * never override live analysis or any statistical gate.
     */
    lessonsBlock?: string | null;
    /**
     * Multi-timeframe chart images with their own numbers. Absent is normal —
     * capture is best-effort and a missing view degrades the read rather than
     * blocking the decision.
     */
    visualSnapshots?: VisualSnapshot[] | null;
    /**
     * Verified statistical backing for this symbol and timeframe. Grades the
     * plan; never decides whether one exists.
     */
    statisticalSupport?: StatisticalSupport | null;
    /**
     * What happened after structurally similar moments, both directions. Absent
     * is normal on a thin memory and is reported as absent.
     */
    historicalCases?: HistoricalCaseEvidence | null;
    /**
     * Extra evidence blocks under fresh keys (macroRegime, cotPositioning…).
     * Spread into the model context by buildModelContext — the designed
     * extension point, so new providers reach the prompt without contract
     * changes. Null blocks are simply absent, never estimated.
     */
    additionalEvidence?: Record<string, unknown> | null;
    /** Fed policy / inflation / curve regime (FRED), for the evidence card. */
    macroRegime?: MacroRegimeBlock | null;
    /** Weekly COT speculative positioning, for the evidence card. */
    cotPositioning?: CotPositioning[] | null;
    /**
     * Live session cost profile, when the sampler has enough data. Carries its
     * own `source` label so a static fallback never masquerades as measured.
     */
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
  let evidenceSnapshot = frozenEvidenceSnapshot(input);
  const user = JSON.stringify(evidenceSnapshot.modelContext);
  // Charts, when we have them. The platform's decision engine used to read a
  // JSON summary while the MCP agent looked at the same market on real charts —
  // two different ways of seeing, and so two different answers to the same
  // question. Same images, same interleaving, same rules on both surfaces now.
  const visualBlocks = buildVisualBlocks(input.visualSnapshots ?? []);
  // The degradation contract (visualEvidence.ts): a missing view degrades the
  // read, it never kills the analysis. When the active model rejects image
  // input, the retry drops the images instead of failing the whole decision.
  let includeVisuals = true;
  const callModel =
    deps.callModel ??
    (async (system: string, userMsg: string) => {
      const content: ContentBlock[] =
        includeVisuals && visualBlocks.length
          ? [{ type: "text", text: userMsg }, ...visualBlocks]
          : [{ type: "text", text: userMsg }];
      const res = await callLLM({
        system,
        messages: [{ role: "user", content }],
        // Headroom for reasoning tokens plus the full plan payload: the three
        // layers, the levels, the conditions, and the decision trace.
        maxTokens: 3072,
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
  // Attempt 2 carries the validator's objections. Without this the retry
  // re-sent the identical prompt and the model repeated the identical mistake
  // — measured on XAUUSD conditional plans, where both attempts failed on the
  // same activationRule shape and the operator saw a generic timeout.
  let correction: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const userMsg = correction
        ? `${user}

[SCHEMA CORRECTION — أعد نفس القرار مع إصلاح هذه الحقول فقط]
${correction}`
        : user;
      const raw = await callModel(system, userMsg);
      const candidate = FinalDecisionModelSchema.parse(JSON.parse(extractJson(raw)));
      // Issue-time price coherence (the XAUUSD conditional-sell incident):
      // schema validation cannot see the live price, so a rule that is
      // already satisfied — or that grades a different event than the
      // sentence describes — passed cleanly and betrayed the user later.
      // Checked HERE so the corrective retry can feed the exact violation
      // back to the model instead of persisting a contradictory plan.
      if (candidate.activationRule && input.market.currentPrice != null) {
        const violation = explainActivationRuleIncoherence({
          rule: candidate.activationRule,
          direction: candidate.direction,
          currentPrice: input.market.currentPrice,
          tolerance: Math.max(
            input.market.spread ?? 0,
            (input.market.atr ?? 0) * 0.1,
          ),
        });
        if (violation) {
          throw new z.ZodError([
            {
              code: z.ZodIssueCode.custom,
              path: ["activationRule"],
              message: violation,
            },
          ]);
        }
      }
      parsed = candidate;
      failure = null;
      break;
    } catch (error) {
      const classified = classifySynthesizerError(error);
      failure = { ...classified, attempts: attempt };
      if (classified.kind === "schema_mismatch" || classified.kind === "invalid_json") {
        correction = classified.detail;
      }
      log.warn("final decision synthesis failed", {
        attempt,
        kind: classified.kind,
        retryable: classified.retryable,
        symbol: input.market.symbol,
        interval: input.market.interval,
        detail: classified.detail.slice(0, 300),
      });
      // A text-only model rejecting the image blocks is not a dead end: retry
      // once WITHOUT the charts. `provider_bad_request` is otherwise final,
      // which turned "model lacks vision" into a failed analysis instead of a
      // numbers-only one.
      const detailText = `${classified.detail} ${String((error as Error)?.message ?? "")}`;
      const imagesRejected =
        classified.kind === "provider_bad_request" &&
        includeVisuals &&
        visualBlocks.length > 0 &&
        /image|vision|multimodal|الرؤية|صور/i.test(detailText);
      if (imagesRejected && attempt < 2) {
        includeVisuals = false;
        log.warn("model rejected chart images — retrying without visual evidence", {
          symbol: input.market.symbol,
          interval: input.market.interval,
        });
        metrics.synthCorrectiveRetries.inc();
        continue;
      }
      if (!classified.retryable || attempt === 2) break;
      // A retry WILL happen — the rate of these is a monitored decision-quality
      // number (plan §2.4): rising retries mean the contract and the model are
      // drifting apart.
      metrics.synthCorrectiveRetries.inc();
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  if (!parsed) {
    return {
      result: null,
      usedLLM: false,
      evidenceSnapshot,
      failure:
        failure ?? {
          kind: "unknown",
          detail: "لم يُنتج نموذج القرار رداً صالحاً.",
          retryable: false,
          attempts: 2,
        },
    };
  }

  // ── The extra-frame round (plan §10 E) ──────────────────────────────────
  // At most ONE, from a whitelist, never a frame already shown, on its own
  // budget. A failed capture or a failed second call keeps THIS decision — the
  // extra view is an offer to refine, never a dependency.
  const extraRequest = normalizeExtraFrameRequest(
    parsed.requestExtraTimeframe,
    input.visualSnapshots ?? [],
  );
  if (extraRequest && deps.captureExtraFrame) {
    metrics.extraFrameRounds.inc({ outcome: "requested" });
    const snapshot = await deps
      .captureExtraFrame(extraRequest)
      .catch(() => null);
    if (snapshot?.imageBase64) {
      try {
        const extraBlocks = buildVisualBlocks([
          ...(input.visualSnapshots ?? []),
          snapshot,
        ]);
        const secondUser =
          `${user}

## Second round
You asked for the ${extraRequest} view; it is now attached with its numbers. ` +
          `Re-issue your FULL decision JSON. requestExtraTimeframe must be null — there is no third round.`;
        const raw = await (deps.callModel
          ? deps.callModel(system, secondUser)
          : callModelWithBlocks(system, secondUser, extraBlocks, ctx));
        const second = FinalDecisionModelSchema.parse(JSON.parse(extractJson(raw)));
        // No third round, whatever the model says.
        second.requestExtraTimeframe = null;
        metrics.extraFrameRounds.inc({ outcome: "completed" });
        ctx.emitActivity({
          type: "analysis",
          status: "completed",
          message: `طلب النموذج فريم ${extraRequest} الإضافي وأُرفق — القرار النهائي بعده.`,
          metadata: { extraTimeframe: extraRequest },
        });
        parsed = second;
        evidenceSnapshot = frozenEvidenceSnapshot({
          ...input,
          visualSnapshots: [...(input.visualSnapshots ?? []), snapshot],
        });
      } catch {
        // The first decision stands. That is the whole contract of the round.
        metrics.extraFrameRounds.inc({ outcome: "second_call_failed" });
      }
    } else {
      metrics.extraFrameRounds.inc({ outcome: "capture_failed" });
    }
  } else if (parsed.requestExtraTimeframe != null && !extraRequest) {
    // Asked for a frame off the whitelist or one already shown: refused, and
    // the first decision stands.
    metrics.extraFrameRounds.inc({ outcome: "refused" });
  }

  return {
    result: applyModelDecision(parsed, input),
    usedLLM: true,
    evidenceSnapshot,
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
    statisticalSupport?: StatisticalSupport | null;
    historicalCases?: HistoricalCaseEvidence | null;
    additionalEvidence?: Record<string, unknown> | null;
  },
): Record<string, unknown> {
  const playbook = input.risk?.playbook ?? null;
  const candidate = input.risk?.selectedCandidate ?? null;
  return {
    // Fixed scalping context. Higher-timeframe facts remain evidence only.
    scalpingContext: SCALPING_CONTEXT,
    // The extension point, named on purpose. A new evidence provider adds a
    // key here and it reaches the model without the brain, the contract or the
    // prompt changing. It used to piggy-back on the live-cost field, which is
    // why consolidating that field broke the property.
    ...(input.additionalEvidence ?? {}),
    // Say it plainly to the model too: strong backing is worth citing, and its
    // absence is worth stating rather than papering over.
    statisticalSupport: (FEATURES.evidencePipelineV2() ? input.statisticalSupport : null) ?? {
      level: "unavailable",
      detail: "No verified strategy evidence for this symbol and timeframe.",
    },
    // What followed structurally similar moments — both directions, so this is
    // evidence to weigh and not a confirmation of a direction already picked.
    // Null means the memory has nothing comparable, which is a fact about the
    // memory and not an argument against the setup.
    historicalCases: input.historicalCases ?? null,
    // What this trade costs in the session it would actually be taken in — the
    // Asian-session spread and the London one are different trades on the same
    // setup, and an average hides exactly the cases where a scalp stops paying.
    // Gated by EVIDENCE_PIPELINE_V2: off falls back to the single observed
    // spread with no session shaping, never to a guessed number.
    // Present whenever EITHER a live cost profile OR an observed spread exists.
    // It used to be gated on the observed spread alone, so on every production
    // request (where market.spread is not wired through) a real live cost
    // profile computed upstream was silently dropped and the model saw
    // executionCost: null — the exact evidence the prompt asks it to weigh when
    // rejecting a bad entry. Fall to null only when there is genuinely no cost
    // signal from either source.
    // ONE shape, always. This used to be a three-branch expression whose
    // key sets were disjoint, so the only downstream reader looked for keys
    // the enabled branch never produced and the spread-drift trigger read NaN.
    // Every unit is named; `unavailable` is stated, never rendered as zero.
    executionCost: serializeCostEvidence(input.market.costEvidence),
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
          // 20, not 10: the engine's own bounds allow 4 trendlines, a channel,
          // 3 patterns and 8 candlestick signals, and candlesticks are appended
          // last — a 10-line cap silently dropped them on any busy chart, which
          // is exactly the evidence the candlestick detector was added to supply.
          lines: geometryEvidenceLines(input.geometry).slice(0, 20),
          // Structures still building, with the boundary an early entry would
          // use. Offered so an anticipatory plan is grounded in a real level
          // rather than the idea of one.
          formingOpportunities: formingOpportunities(input.geometry),
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
    // The menu of real prices a plan may quote. Anything outside it is treated
    // as invented and refused server-side, so the model composes better-price
    // plans from this list instead of doing arithmetic of its own.
    evidenceLevels: buildEvidenceLevels({
      candidates: input.risk?.candidatesResult.candidates ?? [],
      majorLevels: input.market.majorLevels ?? null,
      zones: input.market.zones ?? [],
      liquidity: input.market.liquidity ?? null,
      geometryLevels: input.geometry ? geometryLevelPrices(input.geometry) : [],
    }),
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

/**
 * True when an immediate market entry is too weak given conflicting evidence —
 * MTF conflict, opposite-side candidates, or a timeframe-roles ruling that
 * already names disagreement. Prefer conditional / awaiting_activation.
 */
export function shouldCoerceImmediateOnConflict(input: {
  planType: PlanType;
  mtfConflict?: boolean;
  competingEvidence?: boolean;
  /** Model acknowledged multi-frame roles while MTF conflict is present. */
  timeframeRolesConflict?: boolean;
}): boolean {
  if (input.planType !== "immediate") return false;
  return Boolean(
    input.mtfConflict || input.competingEvidence || input.timeframeRolesConflict,
  );
}

function hasCompetingDirectionalEvidence(
  candidates: ReadonlyArray<{ action: "buy" | "sell"; qualityScore?: number }>,
  direction: "buy" | "sell",
): boolean {
  const opposite = direction === "buy" ? "sell" : "buy";
  return candidates.some(
    (c) => c.action === opposite && (c.qualityScore == null || c.qualityScore >= 0.35),
  );
}

/** Machine-checkable confirmation when an immediate plan is coerced to conditional. */
function synthesizeConflictActivation(input: {
  direction: "buy" | "sell";
  entry: number | null | undefined;
  currentPrice: number | null | undefined;
  interval: string;
  locale?: "ar" | "en";
}): { condition: string; rule: NonNullable<FinalDecisionModelOutput["activationRule"]> } | null {
  const levelCandidate =
    (typeof input.entry === "number" && input.entry > 0 ? input.entry : null) ??
    (typeof input.currentPrice === "number" && input.currentPrice > 0
      ? input.currentPrice
      : null);
  if (levelCandidate == null) return null;
  const kind = input.direction === "buy" ? "candle_close_above" : "candle_close_below";
  const condition =
    input.locale === "en"
      ? `Confirm with a ${input.direction === "buy" ? "close above" : "close below"} ${levelCandidate} before entry — conflicting timeframe evidence makes an immediate fill premature.`
      : `التأكيد بـ${input.direction === "buy" ? "إغلاق فوق" : "إغلاق تحت"} ${levelCandidate} قبل الدخول — تعارض الأدلة بين الفريمات يجعل الدخول الفوري ضعيفاً.`;
  return {
    condition,
    rule: { kind, level: levelCandidate, timeframe: input.interval },
  };
}

/**
 * Turn the model's answer into the three-layer result.
 *
 * The direction is taken as authoritative. The plan's numbers are not: they
 * come from the selected candidate, or from levels the model composed out of
 * the evidence menu and that are re-verified here. Ungrounded numbers are
 * dropped as a set — the direction, the plan type, and the reasoning survive,
 * and the operator is told the plan has no levels yet.
 */
function applyModelDecision(
  parsed: FinalDecisionModelOutput,
  input: FinalDecisionInput & {
    geometry?: GeometrySnapshot | null;
    statisticalSupport?: StatisticalSupport | null;
    historicalCases?: HistoricalCaseEvidence | null;
    macroRegime?: MacroRegimeBlock | null;
    cotPositioning?: CotPositioning[] | null;
    locale?: "ar" | "en";
  },
): FinalDecisionResult {
  const confidence = Math.max(0, Math.min(1, parsed.confidence));
  const clean = (arr: string[], max: number) =>
    arr.map((s) => sanitizePublicText(s).slice(0, 240)).filter(Boolean).slice(0, max);
  const keyReasons = clean(parsed.keyReasons, 6);
  const riskWarnings = clean(parsed.riskWarnings, 6);
  const direction = parsed.direction;

  const candidates = input.risk?.candidatesResult.candidates ?? [];
  const selected =
    candidates.find(
      (candidate) =>
        candidate.id === parsed.selectedTradeCandidateId &&
        candidate.action === direction,
    ) ?? null;

  const currentPrice = input.market.currentPrice ?? 0;
  const evidenceLevels = buildEvidenceLevels({
    candidates: candidates.filter((c) => c.action === direction),
    majorLevels: input.market.majorLevels ?? null,
    zones: input.market.zones ?? [],
    liquidity: input.market.liquidity ?? null,
    geometryLevels: input.geometry ? geometryLevelPrices(input.geometry) : [],
  });
  const tolerance = levelTolerance({
    atr: input.market.atr,
    currentPrice,
    meta: { spread: input.market.spread },
  });
  const resolved = resolvePlanLevels({
    direction,
    selectedCandidate: selected,
    proposed: parsed.proposedLevels ?? null,
    evidenceLevels,
    tolerance,
    meta: { spread: input.market.spread },
  });

  if (!resolved.levels) {
    riskWarnings.unshift(
      resolved.rejectionReason === "proposed_level_not_grounded_in_evidence"
        ? "الاتجاه واضح، لكن المستويات المقترحة لم تُطابق أي مستوى حقيقي في الأدلة فلم تُعتمد."
        : "الاتجاه واضح من الأدلة، لكن لا توجد مستويات دخول/وقف/هدف مؤكدة بعد.",
    );
  }

  const mtfConflict = Boolean(input.mtf?.conflict);
  const competingEvidence = hasCompetingDirectionalEvidence(candidates, direction);
  // timeframeRoles naming lead≠context while MTF conflict is present is the
  // synthesizer's own conflict ruling — still coerce weak immediate entries.
  const timeframeRolesConflict = Boolean(
    mtfConflict &&
      parsed.timeframeRoles?.lead &&
      parsed.timeframeRoles.context &&
      parsed.timeframeRoles.lead !== parsed.timeframeRoles.context,
  );
  let planType: PlanType = parsed.planType;
  let activationCondition = parsed.activationCondition ?? null;
  let activationRule = parsed.activationRule ?? null;
  const coercedFromImmediate = shouldCoerceImmediateOnConflict({
    planType,
    mtfConflict,
    competingEvidence,
    timeframeRolesConflict,
  });
  if (coercedFromImmediate) {
    planType = "conditional";
    if (!activationCondition?.trim() || !activationRule) {
      const synthesized = synthesizeConflictActivation({
        direction,
        entry: resolved.levels?.preferredEntry ?? selected?.entry ?? null,
        currentPrice: input.market.currentPrice,
        interval: input.market.interval,
        locale: input.locale,
      });
      if (synthesized) {
        activationCondition = activationCondition?.trim() || synthesized.condition;
        activationRule = activationRule ?? synthesized.rule;
      }
    }
    riskWarnings.unshift(
      input.locale === "en"
        ? "Conflicting timeframe or competing evidence — plan kept conditional pending confirmation."
        : "تعارض بين الفريمات أو أدلة متنافسة — أُبقيَت الخطة مشروطة بانتظار التأكيد.",
    );
  }

  const executionState = deriveExecutionState({
    planType,
    levels: resolved.levels,
    currentPrice: input.market.currentPrice,
  });

  const setupQuality = selected
    ? Math.min(1, selected.poi.score.score / 100, Math.max(0, selected.qualityScore))
    : null;
  const confidenceSemantics = resolved.levels
    ? buildRecommendationConfidence({
        // The model owns this number: it already sees the geometry, the costs,
        // and the warnings. No hidden ceiling is applied on top of it.
        base: confidence,
        dataQualityScore: input.market.dataQuality.sufficient ? 1 : 0.5,
        setupQuality,
        newsRisk: input.news?.newsRisk ?? "unknown",
        dataSufficientForTrade: input.market.dataQuality.sufficient,
      })
    : buildDirectionalConfidence({
        decisionConfidence: confidence,
        dataQualityScore: input.market.dataQuality.sufficient ? 1 : 0.5,
        reasons: keyReasons,
      });
  const displayConfidence =
    typeof confidenceSemantics.displayValue === "number"
      ? confidenceSemantics.displayValue
      : 0;

  const activationClass: "immediate" | "conditional" =
    planType === "immediate" ? "immediate" : "conditional";
  const netRr = selected?.netRr;
  const normalizedActivationRule = activationRule
    ? normalizeActivationRule(activationRule, input.market.interval)
    : undefined;
  // Single source of truth (the XAUUSD incident): the sentence the user reads
  // is DERIVED from the structured rule the tracker grades, so they can never
  // disagree. The model's own free-text sentence survives only when there is
  // no structured rule to derive from (Arabic locale; the deterministic
  // description is Arabic-only, so English operators keep the model text).
  const derivedCondition =
    normalizedActivationRule && input.locale !== "en"
      ? describeActivationRule(normalizedActivationRule)
      : null;
  const cleanedActivationCondition =
    sanitizePublicText(derivedCondition ?? activationCondition ?? "").slice(0, 400) ||
    undefined;
  const plan: AgentRecommendation | null = resolved.levels
    ? {
        action: direction,
        planType,
        executionState,
        entry: resolved.levels.preferredEntry,
        entryZone: {
          low: resolved.levels.entryLow,
          high: resolved.levels.entryHigh,
        },
        entryType: selected?.entryType,
        stop_loss: resolved.levels.stopLoss,
        targets: resolved.levels.targets,
        take_profit: resolved.levels.targets[0],
        rr: selected?.rr,
        netRr,
        netRrTp2: selected?.netRrTp2,
        activationClass,
        // An immediate plan never inherits the candidate's conditional text:
        // a card whose header says "valid now" must not carry a body sentence
        // saying "only executable if price returns to the zone".
        triggerCondition:
          cleanedActivationCondition ||
          (planType === "immediate" ? undefined : selected?.triggerCondition),
        // Carried when the model stated one, or when conflict coercion synthesized it.
        activationRule: normalizedActivationRule,
        invalidationLevel: resolved.levels.stopLoss,
        invalidationRule:
          sanitizePublicText(parsed.invalidationRule).slice(0, 400) ||
          selected?.invalidationReason,
        alternativeScenario: sanitizePublicText(parsed.alternativeScenario).slice(0, 400),
        validityCandles: parsed.validityCandles,
        levelSource: resolved.source ?? undefined,
        status: executionState === "valid_now" ? "triggered" : "pending_entry",
      }
    : {
        action: direction,
        planType,
        executionState,
        triggerCondition: cleanedActivationCondition,
        activationRule: normalizedActivationRule,
        invalidationRule: sanitizePublicText(parsed.invalidationRule).slice(0, 400),
        alternativeScenario: sanitizePublicText(parsed.alternativeScenario).slice(0, 400),
        validityCandles: parsed.validityCandles,
      };

  const timeframeRoles = parsed.timeframeRoles
    ? {
        lead: sanitizePublicText(parsed.timeframeRoles.lead).slice(0, 16),
        context: parsed.timeframeRoles.context
          ? sanitizePublicText(parsed.timeframeRoles.context).slice(0, 16)
          : null,
        timing: parsed.timeframeRoles.timing
          ? sanitizePublicText(parsed.timeframeRoles.timing).slice(0, 16)
          : null,
      }
    : // The ruling is part of the contract (plan §10 E): when the model omits
      // it, the analysis frame led by construction — recorded as such rather
      // than dropped, so every decision carries a timeframe-agreement ruling.
      { lead: input.market.interval, context: null, timing: null };

  const publicReasoningSummary = clean(parsed.publicReasoningSummary, 5);
  const alternativeScenario = sanitizePublicText(parsed.alternativeScenario).slice(0, 400);
  // On conflict-driven conditional plans, surface adopted vs alternative when missing.
  if (
    (coercedFromImmediate || mtfConflict || competingEvidence) &&
    alternativeScenario &&
    !publicReasoningSummary.some((line) =>
      /alternative|البديل|السيناريو البديل|runner-up|adopted|المعتمد/i.test(line),
    )
  ) {
    const note =
      input.locale === "en"
        ? `Adopted scenario stands; alternative if invalidation hits: ${alternativeScenario}`
        : `السيناريو المعتمد قائم؛ البديل عند الإبطال: ${alternativeScenario}`;
    const cleanedNote = sanitizePublicText(note).slice(0, 240);
    if (publicReasoningSummary.length >= 5) {
      publicReasoningSummary[4] = cleanedNote;
    } else {
      publicReasoningSummary.push(cleanedNote);
    }
  }

  return {
    decision: direction,
    planType,
    executionState,
    timeframeRoles,
    confidence: displayConfidence,
    confidenceSemantics,
    summary: sanitizePublicText(parsed.summary).slice(0, 900),
    keyReasons,
    riskWarnings: riskWarnings.slice(0, 6),
    recommendation: plan!,
    decisionTrace: sanitizeDecisionTrace(parsed.decisionTrace),
    evidenceDimensions: buildEvidenceDimensions({
      planType,
      executionState,
      signalStrength: confidence,
      timeframeAgreement: input.mtf
        ? input.mtf.conflict
          ? "conflicting"
          : "aligned"
        : "unknown",
      patternState: input.geometry ? describePrimaryPattern(input.geometry) : null,
      patternCompletion: input.geometry?.patterns?.[0]?.completionRatio ?? null,
      entryQuality: selected ? selected.poi.score.score : null,
      netR: netRr ?? null,
      belowPreferredNetR:
        netRr != null ? netRr + 1e-9 < SCALP_GEOMETRY.minNetTp1R : undefined,
      statisticalSupport: input.statisticalSupport?.level ?? "unavailable",
      statisticalDetail: input.statisticalSupport?.detail ?? null,
      historicalCases: historicalCaseCard(input.historicalCases, direction),
      newsRisk: input.news?.newsRisk ?? "unknown",
      macroRegime: input.macroRegime ?? null,
      cotPositioning: input.cotPositioning ?? null,
      dataSufficient: input.market.dataQuality.sufficient,
      validityCandles: parsed.validityCandles,
    }).dimensions,
    publicReasoningSummary: publicReasoningSummary.slice(0, 5),
  };
}

/**
 * Chart images, each preceded by a label naming its timeframe and carrying that
 * timeframe's numbers.
 *
 * The interleaving is the point: an unlabelled batch of charts leaves the model
 * guessing which one is the 4h, and a wrong binding is worse than no image at
 * all. This mirrors exactly what the MCP surface sends.
 */
export function buildVisualBlocks(snapshots: VisualSnapshot[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const snapshot of snapshots) {
    if (!snapshot.imageBase64) continue;
    blocks.push({
      type: "text",
      text: JSON.stringify({
        chart_timeframe: snapshot.timeframe,
        numeric_context: snapshot.numericContext ?? null,
        note: "Shape only — quote levels from the numeric evidence, never from the pixels.",
      }),
    });
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: snapshot.imageBase64,
      },
    });
  }
  return blocks;
}

/** Operator-safe copy of the model's reasoning trace (never raw scratchpad). */
function sanitizeDecisionTrace(
  trace: FinalDecisionModelOutput["decisionTrace"],
): DecisionTrace {
  const line = (text: string, max = 240) => sanitizePublicText(text).slice(0, max);
  return {
    hypotheses: trace.hypotheses.slice(0, 3).map((h) => ({
      scenario: line(h.scenario),
      supporting: h.supporting.map((s) => line(s, 160)).filter(Boolean).slice(0, 4),
      opposing: h.opposing.map((s) => line(s, 160)).filter(Boolean).slice(0, 4),
    })),
    chosenBecause: line(trace.chosenBecause, 400),
    planTypeBecause: line(trace.planTypeBecause, 400),
  };
}

/**
 * Patterns whose boundary is a plausible early entry.
 *
 * "Not complete yet" was read as "nothing here" for years. A triangle pressing
 * its rising lows, a double top on its second rejection — those ARE the
 * anticipatory setups the doctrine asks for, and they need a real level to hang
 * on, which is what this hands over.
 */
function formingOpportunities(geometry: GeometrySnapshot): Array<{
  pattern: string;
  stage: string;
  completion: number | null;
  boundary: number | null;
  expectedBreak: "up" | "down" | null;
}> {
  return (geometry.patterns ?? [])
    .filter((pattern) => pattern.stage != null && offersAnticipatoryEntry(pattern.stage))
    .slice(0, 3)
    .map((pattern) => ({
      pattern: pattern.patternType,
      stage: pattern.stage!,
      completion: pattern.completionRatio ?? null,
      boundary: breakLevelOf(pattern),
      expectedBreak: pattern.breakDirection ?? null,
    }));
}

/** Prices a plan may legitimately cite from detected chart geometry. */
function geometryLevelPrices(geometry: GeometrySnapshot): number[] {
  const out: number[] = [];
  for (const pattern of geometry.patterns ?? []) {
    if (typeof pattern.projectedTarget === "number") out.push(pattern.projectedTarget);
    if (pattern.neckline) {
      out.push(pattern.neckline.from.price, pattern.neckline.to.price);
    }
    for (const anchor of pattern.anchors ?? []) out.push(anchor.price);
  }
  return out.filter((p) => Number.isFinite(p) && p > 0);
}

/**
 * The case-memory row of the evidence card, for the direction actually chosen.
 *
 * The bundle carries both sides; the card reports the one the plan is on, since
 * that is the number the operator is being asked to act against.
 */
function historicalCaseCard(
  evidence: HistoricalCaseEvidence | null | undefined,
  direction: "buy" | "sell",
): { count: number; winRate?: number | null } | null {
  if (!evidence) return null;
  const side = direction === "buy" ? evidence.long : evidence.short;
  if (side.sampleSize <= 0) return null;
  return { count: side.sampleSize, winRate: side.hitRate };
}

/** Short human label for the most significant detected pattern. */
function describePrimaryPattern(geometry: GeometrySnapshot): string | null {
  const pattern = (geometry.patterns ?? [])[0];
  if (!pattern) return null;
  return `${pattern.patternType} · ${pattern.stage ?? pattern.status}`;
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
