/**
 * Agent Artifact cards: the contract.
 *
 * ## Why this shape, and not a schema registry
 *
 * The plan asks for 22 card types, each with a schema, a renderer and a
 * Telegram fallback. The obvious build is a registry of 22 schemas that a
 * composer emits and a switch renders — which is EXACTLY what this repo already
 * had once, in `cardComposer.ts` / `cardPolicy.ts` / `uiSchema.ts`: 596 lines of
 * complete card pipeline with zero consumers, deleted in Phase 7 because
 * nothing imported any of it and the components it emitted belonged to a
 * product that no longer exists.
 *
 * That failure has a shape, and it is the same one found eight other times in
 * this migration: structure present, wiring absent. A card type that a model
 * must choose to emit is a card type that silently never appears. A renderer
 * keyed by string is a renderer that silently renders nothing. Neither failure
 * shows up in a type check or a unit test.
 *
 * So this contract is built to make both impossible:
 *
 *  1. **Cards are DERIVED, never authored.** `deriveCards` is a pure function
 *     from the result the orchestrator already produces. A card type cannot
 *     exist without a field behind it, and no model has to remember to emit
 *     one. If the data is there, the card is there.
 *
 *  2. **The union is closed, and every consumer is exhaustive.** Both renderers
 *     switch over `AgentCard["kind"]` and end in a `never` assignment, so
 *     adding a variant here without teaching the panel AND Telegram about it
 *     fails `tsc`. Parity stops being a promise and becomes a compile error.
 *
 * ## What a card is not
 *
 * A card carries data, never markup and never a control. There is nothing to
 * execute on this platform, so no card has an action — the one button-shaped
 * variant, `follow_up_options`, sends a chat message and nothing else.
 */
import type { AgentStageEvent } from "../stageEvents";
import type { CandleCoverageReport } from "../dataQualityPolicy";
import type { ConfidenceSemantics } from "../confidenceSemantics";
import type { EvidenceCard } from "../evidenceCard";
import type { EvidenceDimension } from "../evidenceDimensions";
import type { EvidenceTimelineStep } from "../researchEvidence";
import type { GateVerdict } from "../gates/types";
import type { ResultEnvelope } from "../resultEnvelope";
import type { AgentDecision, AgentNewsRisk, AgentOption, DecisionTrace } from "../types";

/**
 * Every card kind, in display order.
 *
 * The order is the reading order on both surfaces: what was decided, then the
 * plan, then why, then what the answer rests on, then how it was produced.
 * Keeping it in one array rather than scattered across two renderers is what
 * lets the Telegram message and the panel agree without either one owning the
 * sequence.
 */
export const CARD_ORDER = [
  "scenario_notice",
  "decision",
  "plan_levels",
  "activation",
  "invalidation",
  "alternative_scenario",
  "gate_checklist",
  "key_reasons",
  "public_reasoning",
  "decision_trace",
  "evidence_strategy",
  "evidence_dimensions",
  "risk_warnings",
  "news_risk",
  "cost_evidence",
  "research_evidence",
  "evidence_timeline",
  "candle_coverage",
  "tracked_recommendation",
  "envelope_status",
  "skills_used",
  "run_stages",
  "follow_up_options",
] as const;

export type CardKind = (typeof CARD_ORDER)[number];

/** What the plan asks for, pinned so a silent drop is a test failure. */
export const EXPECTED_CARD_TYPES = 23;

/**
 * The market is closed and this answer is a next-open scenario.
 *
 * First in the reading order on purpose: everything below it — the plan, the
 * gates, the reasons — is framed by this one fact, and an operator who reads
 * the plan before learning the market is closed has been misled for exactly
 * that long.
 */
export interface ScenarioNoticeCard {
  kind: "scenario_notice";
  /** Epoch ms of the next session open. */
  nextOpenAt: number;
  /** The calendar's Arabic reason (Saturday / Friday close / Sunday…). */
  reasonAr: string;
}

/** The decision itself, with its confidence expressed the one honest way. */
export interface DecisionCard {
  kind: "decision";
  decision: AgentDecision;
  summary: string;
  /** Never rendered as a bare number — see `confidenceSemantics.ts`. */
  confidence: number;
  semantics?: ConfidenceSemantics;
}

/** Entry, stop and targets. The numbers, and where they came from. */
export interface PlanLevelsCard {
  kind: "plan_levels";
  direction: "buy" | "sell";
  entry: number;
  /** The area the plan will enter from, when it is an area. */
  entryZone?: { low: number; high: number };
  stopLoss: number;
  targets: number[];
  /** Net of costs, which is the only reward:risk worth showing. */
  netRr?: number;
  entryType?: string;
  levelSource?: "candidate" | "evidence_levels";
}

/** What has to happen before the plan is live. */
export interface ActivationCard {
  kind: "activation";
  activationClass: "immediate" | "conditional";
  triggerCondition?: string;
  /** How many candles of the analysed frame the plan stays meaningful. */
  validityCandles?: number;
  executionState?: string;
}

/** What proves the plan wrong — stated before it happens, not after. */
export interface InvalidationCard {
  kind: "invalidation";
  level?: number;
  rule?: string;
}

/** The runner-up read, and what would switch to it. */
export interface AlternativeScenarioCard {
  kind: "alternative_scenario";
  scenario: string;
}

/**
 * G1–G7 as the operator sees them: the checklist as far as it got.
 *
 * Present on a refusal AND on a pass. A checklist shown only when it blocks
 * teaches the operator that gates are bad news rather than that they ran.
 */
export interface GateChecklistCard {
  kind: "gate_checklist";
  verdicts: GateVerdict[];
  allowed: boolean;
  vetoedBy?: string;
}

export interface KeyReasonsCard {
  kind: "key_reasons";
  reasons: string[];
}

/** Public reasoning — conclusions, never chain-of-thought. */
export interface PublicReasoningCard {
  kind: "public_reasoning";
  points: string[];
}

export interface DecisionTraceCard {
  kind: "decision_trace";
  trace: DecisionTrace;
}

/** The factory's validated history behind this read. */
export interface EvidenceStrategyCard {
  kind: "evidence_strategy";
  card: EvidenceCard;
}

/** Evidence dimension by dimension, with `unavailable` as a real grade. */
export interface EvidenceDimensionsCard {
  kind: "evidence_dimensions";
  dimensions: EvidenceDimension[];
}

export interface RiskWarningsCard {
  kind: "risk_warnings";
  warnings: string[];
}

export interface NewsRiskCard {
  kind: "news_risk";
  risk: AgentNewsRisk;
}

/** What the fill actually costs, in pips, with its source named. */
export interface CostEvidenceCard {
  kind: "cost_evidence";
  spreadPips: number | null;
  source: string | null;
  session: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
}

/** Which research systems contributed, and which were skipped and why. */
export interface ResearchEvidenceCard {
  kind: "research_evidence";
  summaryAr: string;
  summaryEn: string;
  used: string[];
  skipped: Array<{ system: string; reason: string }>;
}

export interface EvidenceTimelineCard {
  kind: "evidence_timeline";
  steps: EvidenceTimelineStep[];
}

/** Whether the data behind the answer was actually sufficient. */
export interface CandleCoverageCard {
  kind: "candle_coverage";
  report: CandleCoverageReport;
}

/** The recommendation this run stored, now being tracked to an outcome. */
export interface TrackedRecommendationCard {
  kind: "tracked_recommendation";
  id: string;
  status: string;
  direction: "buy" | "sell";
  symbol: string;
  interval: string;
}

/** The three-state outcome contract, shown when it is not a clean success. */
export interface EnvelopeStatusCard {
  kind: "envelope_status";
  envelope: ResultEnvelope;
}

/** Which skills loaded, and — honestly — which failed to. */
export interface SkillsUsedCard {
  kind: "skills_used";
  loaded: Array<{ name: string; version: string }>;
  failed: Array<{ name: string; version: string; error: string }>;
}

/** How this answer was produced. */
export interface RunStagesCard {
  kind: "run_stages";
  stages: AgentStageEvent[];
}

/** The only card with anything clickable, and it sends a message. */
export interface FollowUpOptionsCard {
  kind: "follow_up_options";
  options: AgentOption[];
}

export type AgentCard =
  | ScenarioNoticeCard
  | DecisionCard
  | PlanLevelsCard
  | ActivationCard
  | InvalidationCard
  | AlternativeScenarioCard
  | GateChecklistCard
  | KeyReasonsCard
  | PublicReasoningCard
  | DecisionTraceCard
  | EvidenceStrategyCard
  | EvidenceDimensionsCard
  | RiskWarningsCard
  | NewsRiskCard
  | CostEvidenceCard
  | ResearchEvidenceCard
  | EvidenceTimelineCard
  | CandleCoverageCard
  | TrackedRecommendationCard
  | EnvelopeStatusCard
  | SkillsUsedCard
  | RunStagesCard
  | FollowUpOptionsCard;

/**
 * Cards that open collapsed.
 *
 * Diagnostic depth, not the answer. Everything an operator needs to ACT on
 * stays expanded; everything that explains how the answer was produced is one
 * click away. The set lives here rather than in the panel so the Telegram
 * renderer can make the same call — it drops these from the message body
 * instead of sending a wall of diagnostics to a phone.
 */
export const COLLAPSED_BY_DEFAULT: ReadonlySet<CardKind> = new Set([
  "decision_trace",
  "evidence_timeline",
  "candle_coverage",
  "research_evidence",
  "skills_used",
  "run_stages",
  // Internal taxonomy (descriptive_only / operational_blocker). The panel
  // has its own badge; a phone must never print the enum.
  "envelope_status",
]);

/**
 * The exhaustiveness guard both renderers end with.
 *
 * Reached only if a variant was added to `AgentCard` without a case, which
 * `tsc` refuses to compile — the whole point of the closed union. It throws
 * rather than returning null so that a JS-side caller which bypassed the types
 * still fails loudly instead of rendering a blank.
 */
export function assertNeverCard(card: never): never {
  throw new Error(
    `unhandled agent card: ${JSON.stringify((card as { kind?: string })?.kind ?? card)}`,
  );
}
