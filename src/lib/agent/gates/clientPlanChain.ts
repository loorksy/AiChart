/**
 * The client-plan gate chain — the MCP path's whole server-side contribution.
 *
 * Division of labour (Phase B): the CLIENT model thinks and decides; the
 * platform provides data and enforces gates. This module is the enforcement
 * half. It takes a plan an external model already made — direction, levels,
 * fill semantics, activation rule — rebuilds the same deterministic evidence
 * the platform's own gates read (structure, liquidity, zones, MTF bias, news
 * window, ATR, live price), and runs the SAME G1–G7 chain over the client's
 * plan in forced order, in one server call.
 *
 * Nothing here calls an LLM. Every input is computed arithmetic over stored
 * candles, a calendar read, or a quote — which is what makes a complete MCP
 * recommendation possible at zero platform model spend. The structural test
 * in __tests__/mcpZeroLlm.test.ts walks this module's import graph to keep it
 * that way.
 *
 * The verdicts are recorded through `recordGateChain`, so the analysis id this
 * returns is exactly what `assertGateRecordsAllowCreation` — unchanged — will
 * check at the write boundary. A refused chain is recorded too: the refusal
 * names its gate and reason, and the record proves the question was asked.
 */
import { newId } from "@/lib/agent/activity";
import type { AgentRunContext } from "@/lib/agent/types";
import {
  buildAgentMarketContext,
  type AgentMarketContext,
} from "@/lib/agent/marketContext/buildAgentMarketContext";
import { runStructureAgent } from "@/lib/agent/agents/structureAgent";
import { runLiquidityAgent } from "@/lib/agent/agents/liquidityAgent";
import { runSupplyDemandAgent } from "@/lib/agent/agents/supplyDemandAgent";
import { runMultiTimeframeAgent } from "@/lib/agent/agents/multiTimeframeAgent";
import {
  runNewsMacroAgent,
  type NewsMacroResult,
} from "@/lib/agent/agents/newsMacroAgent";
import { newsProviderConfigured } from "@/lib/agent/news/newsProvider";
import { getForexLiveQuote } from "@/lib/markets/forexPrice";
import { recordGateChain } from "@/lib/recommendations/gateRecords";
import {
  resolveEntryType,
  type EntryType,
} from "@/lib/recommendations/entrySemantics";
import type { ActivationRule } from "@/lib/recommendations/activationRule";
import { buildGates } from "./buildGates";
import { refusalSummaryAr, runGateChain } from "./chain";
import type { GateVerdict } from "./types";

/** The plan as the CLIENT stated it — the object the gates grade. */
export interface ClientPlan {
  direction: "buy" | "sell";
  /** Whatever the client called the fill — resolved by structure, not belief. */
  declaredEntryType?: string | null;
  planType?: "immediate" | "anticipatory" | "conditional" | null;
  entry: number;
  stopLoss: number;
  targets: number[];
  activationRule?: ActivationRule | null;
}

export interface ClientPlanChainInput {
  userId: number;
  symbol: string;
  interval: string;
  plan: ClientPlan;
  /** Chart frames the client actually reviewed — G4's honesty evidence. */
  visualTimeframes?: string[];
  requestId?: string;
  /** Injectable for tests; defaults to a fresh UUID. */
  analysisId?: string;
}

export interface ClientPlanChainResult {
  analysisId: string;
  symbol: string;
  interval: string;
  /** The canonical fill semantics the chain graded (and the write will store). */
  entryType: EntryType;
  allowed: boolean;
  verdicts: GateVerdict[];
  vetoedBy: GateVerdict | null;
  /** Operator-language refusal naming the gate and its reason; null when allowed. */
  refusalAr: string | null;
  confidenceDelta: number;
  currentPrice: number | null;
  atr: number | null;
  marketOpen: boolean;
  recordedAt: number;
}

/**
 * Every effect the chain has on the world, injectable so the functional test
 * can feed real candles and a pinned clock without any network. Defaults are
 * the production wiring.
 */
export interface ClientPlanChainDeps {
  now?: () => number;
  buildMarket?: typeof buildAgentMarketContext;
  runStructure?: typeof runStructureAgent;
  runLiquidity?: typeof runLiquidityAgent;
  runSupplyDemand?: typeof runSupplyDemandAgent;
  runMtf?: typeof runMultiTimeframeAgent;
  runNews?: (
    ctx: AgentRunContext,
    input: { symbol?: string },
  ) => Promise<NewsMacroResult>;
  newsProviderConfigured?: () => boolean;
  /** Gate-time quote. Default mirrors the orchestrator's G7 policy. */
  fetchLivePrice?: (market: AgentMarketContext) => Promise<number | null>;
  record?: typeof recordGateChain;
}

/**
 * The orchestrator's G7 quote policy, verbatim in behavior: a FRESH mid from
 * the live feed while the market trades; the last CLOSE when the tape is
 * paused — the honest price of a closed market, and the number every other
 * part of the evidence was computed from.
 */
function defaultFetchLivePrice(
  userId: number,
  market: AgentMarketContext,
): () => Promise<number | null> {
  if (!market.marketOpen) {
    return () => Promise.resolve(market.currentTfCandles.at(-1)?.close ?? null);
  }
  return () =>
    getForexLiveQuote(userId, market.symbol, { timeoutMs: 3_000 })
      .then((quote) => (quote ? (quote.bid + quote.ask) / 2 : null))
      .catch(() => null);
}

/** Silent specialist context: this path narrates through its RESULT, not a stream. */
function chainContext(input: {
  requestId: string;
  userId: number;
}): AgentRunContext {
  return {
    requestId: input.requestId,
    userId: input.userId,
    emitActivity: () => {},
  };
}

/**
 * Run the full G1–G7 chain over a client-authored plan and record the verdicts.
 *
 * Order is forced by construction: the chain is built and run server-side in
 * this one call, so a client cannot skip a gate, reorder them, or claim a pass
 * it never earned. The returned `analysisId` is the ONLY currency the write
 * boundary accepts, and it buys nothing unless the recorded chain allowed.
 */
export async function runClientPlanGateChain(
  input: ClientPlanChainInput,
  deps: ClientPlanChainDeps = {},
): Promise<ClientPlanChainResult> {
  const now = deps.now ?? Date.now;
  const analysisId = input.analysisId ?? newId();
  const requestId = input.requestId ?? `gates-${analysisId}`;
  const ctx = chainContext({ requestId, userId: input.userId });

  const market = await (deps.buildMarket ?? buildAgentMarketContext)({
    userId: input.userId,
    symbol: input.symbol,
    interval: input.interval,
  });

  // The same deterministic specialists the platform's own run feeds its gates
  // from — re-read here as gate ANSWERS for the client's plan. All arithmetic
  // over candles; news is a calendar read. No model call anywhere below.
  const [structure, liquidity, supplyDemand, mtf, news] = await Promise.all([
    (deps.runStructure ?? runStructureAgent)(ctx, market).catch(() => null),
    (deps.runLiquidity ?? runLiquidityAgent)(ctx, market).catch(() => null),
    (deps.runSupplyDemand ?? runSupplyDemandAgent)(ctx, market).catch(() => null),
    (deps.runMtf ?? runMultiTimeframeAgent)(ctx, market).catch(() => null),
    (deps.runNews ?? runNewsMacroAgent)(ctx, { symbol: market.symbol }).catch(
      () => null,
    ),
  ]);

  // Structure decides the fill semantics, not the client's declaration — the
  // same resolution the write boundary applies, so the chain grades exactly
  // what would be stored.
  const entryType = resolveEntryType({
    declared: input.plan.declaredEntryType,
    planType: input.plan.planType ?? null,
    activationRule: input.plan.activationRule ?? null,
  });

  const { gates } = buildGates({
    now: now(),
    news,
    newsProviderConfigured: (deps.newsProviderConfigured ?? newsProviderConfigured)(),
    structure,
    liquidity,
    supplyDemand,
    mtf,
    atr: market.atr ?? 0,
    visualTimeframes: input.visualTimeframes,
    plan: {
      direction: input.plan.direction,
      entryType,
      entry: input.plan.entry,
      stopLoss: input.plan.stopLoss,
      targets: input.plan.targets,
      activationRule: input.plan.activationRule ?? null,
      // No RR floor, deliberately — reward:risk is descriptive evidence, not
      // an acceptance threshold. Same policy as the platform's own chain.
    },
    fetchLivePrice: deps.fetchLivePrice
      ? () => deps.fetchLivePrice!(market)
      : defaultFetchLivePrice(input.userId, market),
  });

  const chain = await runGateChain(gates, now);

  // The record IS the product of this call: without it the analysis id buys
  // nothing at the write boundary. So unlike the orchestrator's best-effort
  // logging, a persist failure here throws — a named error beats an id that
  // silently authorizes nothing. Refusals are recorded too: a veto is evidence.
  const recordedAt = now();
  await (deps.record ?? recordGateChain)({
    userId: input.userId,
    analysisId,
    symbol: market.symbol,
    verdicts: chain.verdicts,
    chainAllowed: chain.allowed,
    now: recordedAt,
  });

  return {
    analysisId,
    symbol: market.symbol,
    interval: market.interval,
    entryType,
    allowed: chain.allowed,
    verdicts: chain.verdicts,
    vetoedBy: chain.vetoedBy ?? null,
    refusalAr: refusalSummaryAr(chain),
    confidenceDelta: chain.confidenceDelta,
    currentPrice: market.currentPrice,
    atr: market.atr,
    marketOpen: market.marketOpen,
    recordedAt,
  };
}
