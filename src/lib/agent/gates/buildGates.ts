/**
 * The bridge between the specialist fleet and the gate chain.
 *
 * The specialists already run — structure, liquidity, supply/demand, MTF,
 * news, risk. What they did NOT do was decide anything: their output went to
 * the synthesizer as evidence, and the synthesizer weighed it. That is right
 * for direction and wrong for tradability, because a weighed veto is not a
 * veto. This module re-reads exactly the same results as gate ANSWERS, so the
 * plan is refused by name rather than argued down by a prompt.
 *
 * Nothing here re-runs a specialist or issues a second opinion on direction.
 * Every gate answers a factual question about whether a plan may exist at all.
 */
import { t } from "@/lib/i18n";
import type { GateDefinition } from "./chain";
import { evaluateNewsWindow, newsBlockReasonAr } from "./newsWindow";
import type { BlockingEvent } from "./newsWindow";
import { revalidatePlan } from "./revalidation";
import type { StructureResult } from "../agents/structureAgent";
import type { LiquidityResult } from "../agents/liquidityAgent";
import type { SupplyDemandResult } from "../agents/supplyDemandAgent";
import type { MultiTimeframeResult } from "../agents/multiTimeframeAgent";
import type { NewsMacroResult } from "../agents/newsMacroAgent";
import { validateEntryCoherence } from "@/lib/recommendations/entrySemantics";
import type { EntryPlan } from "@/lib/recommendations/entrySemantics";

export interface GateInputs {
  /** Wall clock for the news window; injectable so the chain is testable. */
  now: number;
  news: NewsMacroResult | null;
  /** False when no calendar provider has ever been configured on this install. */
  newsProviderConfigured: boolean;
  structure: StructureResult | null;
  liquidity: LiquidityResult | null;
  supplyDemand: SupplyDemandResult | null;
  mtf: MultiTimeframeResult | null;
  /** Unused — backtest apparatus deleted. Kept optional so callers compile. */
  statisticalSupport?: unknown;
  /** The plan about to be constructed, in canonical entry semantics. */
  plan: EntryPlan;
  /** ATR on the entry timeframe, price units — G7's reachability yardstick. */
  atr: number;
  /**
   * The chart frames the decision was actually made on.
   *
   * A plan read from numbers alone is not refused — the platform has always
   * degraded to that rather than going silent — but it is a materially weaker
   * plan, and the verdict bundle is the only place a post-mortem can learn
   * whether the brain had eyes.
   */
  visualTimeframes?: string[];
  /** A quote fetched at gate time, not the one the run started with. */
  fetchLivePrice: () => Promise<number | null>;
}

/** ISO event times to epoch ms, dropping anything unparseable. */
function toBlockingEvents(
  events: NewsMacroResult["upcomingEvents"],
): BlockingEvent[] {
  const out: BlockingEvent[] = [];
  for (const event of events) {
    const time = Date.parse(event.time);
    if (!Number.isFinite(time)) continue;
    out.push({
      title: event.title,
      time,
      impact: event.impact,
      currency: event.currency,
    });
  }
  return out;
}

export interface GateBuildResult {
  gates: GateDefinition[];
}

export function buildGates(input: GateInputs): GateBuildResult {

  const gates: GateDefinition[] = [
    {
      id: "G1",
      // An install with no calendar provider is a deployment gap, not a live
      // outage; a configured provider that failed IS one and blocks.
      required: input.newsProviderConfigured,
      run: async () => {
        if (!input.news) {
          return {
            status: "unavailable",
            reasonAr: t("ar", "gate.news.calendar_timeout"),
          };
        }
        if (input.news.newsRisk === "unknown") {
          return {
            status: "unavailable",
            reasonAr: input.news.reason || t("ar", "gate.news.window_unconfirmed"),
            evidence: { configured: input.newsProviderConfigured },
          };
        }
        const verdict = evaluateNewsWindow({
          events: toBlockingEvents(input.news.upcomingEvents),
          now: input.now,
        });
        if (verdict.blocked) {
          return {
            status: "veto",
            reasonAr: newsBlockReasonAr(verdict) ?? t("ar", "gate.news.high_impact_window"),
            evidence: {
              event: verdict.event?.title,
              minutesUntilClear: verdict.minutesUntilClear,
            },
          };
        }
        return {
          status: "pass",
          // A high overall news regime outside the blackout is a cost, not a
          // refusal — the plan may exist, with less confidence behind it.
          confidenceDelta: input.news.newsRisk === "high" ? -10 : 0,
          evidence: { newsRisk: input.news.newsRisk },
        };
      },
    },

    {
      id: "G2",
      run: async () => {
        if (!input.liquidity) {
          return { status: "unavailable", reasonAr: t("ar", "gate.liquidity.unavailable") };
        }
        return {
          status: "pass",
          evidence: {
            equalHighs: input.liquidity.equalHighs.length,
            equalLows: input.liquidity.equalLows.length,
            sweeps: input.liquidity.sweeps.length,
          },
        };
      },
    },

    {
      id: "G3",
      run: async () => {
        if (!input.supplyDemand) {
          return { status: "unavailable", reasonAr: t("ar", "gate.supply_demand.unavailable") };
        }
        const side =
          input.plan.direction === "buy"
            ? input.supplyDemand.nearestDemand
            : input.supplyDemand.nearestSupply;
        return {
          status: "pass",
          evidence: {
            zones: input.supplyDemand.zones.length,
            nearestOnPlanSide: side ? { low: side.low, high: side.high } : null,
          },
        };
      },
    },

    {
      id: "G4",
      run: async () => {
        if (!input.structure) {
          return {
            status: "unavailable",
            reasonAr: t("ar", "gate.structure.unavailable"),
          };
        }
        // An HTF conflict does not flip the plan; the direction stays the
        // model's. It costs confidence, which is what disagreement is worth.
        const conflict = input.mtf?.conflict === true;
        const seen = input.visualTimeframes ?? [];
        const blind = seen.length === 0;
        const reasons = [
          conflict ? t("ar", "gate.structure.htf_conflict") : null,
          blind ? t("ar", "gate.structure.no_chart_snapshot") : null,
        ].filter(Boolean);
        return {
          status: "pass",
          confidenceDelta: (conflict ? -10 : 0) + (blind ? -10 : 0),
          reasonAr: reasons.length ? reasons.join(" ") : undefined,
          evidence: {
            trend: input.structure.trend,
            latestStructureEvent: input.structure.latestStructureEvent?.type ?? null,
            currentBias: input.mtf?.currentBias ?? null,
            higherBias: input.mtf?.higherBias ?? null,
            conflict,
            // What the brain could actually see when it decided.
            visualTimeframes: seen,
          },
        };
      },
    },

    {
      id: "G5",
      required: false,
      run: async () => ({
        status: "pass",
        evidence: { statistical_claims: "removed" },
      }),
    },

    {
      id: "G6",
      run: async () => {
        // The incident gate. A plan whose activation rule and fill semantics
        // contradict each other is refused HERE, before it can be stored and
        // graded against a level its own condition made unreachable.
        const problems = validateEntryCoherence(input.plan);
        if (problems.length > 0) {
          return {
            status: "veto",
            reasonAr: t("ar", "gate.plan.incoherent", {
              problems: problems.map((p) => p.code).join(", "),
            }),
            evidence: { problems },
          };
        }
        return {
          status: "pass",
          evidence: {
            entryType: input.plan.entryType,
            targets: input.plan.targets.length,
          },
        };
      },
    },

    {
      id: "G7",
      run: async () => {
        const price = await input.fetchLivePrice();
        if (price == null || !Number.isFinite(price) || price <= 0) {
          return {
            status: "unavailable",
            reasonAr: t("ar", "gate.live_price.unavailable"),
          };
        }
        const verdict = revalidatePlan({
          direction: input.plan.direction,
          effectiveEntry: input.plan.entry,
          stopLoss: input.plan.stopLoss,
          targets: input.plan.targets,
          currentPrice: price,
          atr: input.atr,
          minRr: input.plan.minRr,
        });
        if (verdict.status !== "ok") {
          return {
            status: "veto",
            reasonAr: verdict.reasonAr ?? t("ar", "gate.live_price.plan_invalid"),
            evidence: { ...verdict, currentPrice: price },
          };
        }
        return {
          status: "pass",
          evidence: { currentPrice: price, liveRr: verdict.liveRr },
        };
      },
    },
  ];

  return { gates };
}
