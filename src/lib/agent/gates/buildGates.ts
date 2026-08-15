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
import type { GateDefinition } from "./chain";
import { evaluateNewsWindow, newsBlockReasonAr } from "./newsWindow";
import type { BlockingEvent } from "./newsWindow";
import { confidenceFromEvidence, gradeStrategyEvidence } from "./strategyEvidence";
import type { StrategyMatch } from "./strategyEvidence";
import { revalidatePlan } from "./revalidation";
import type { StructureResult } from "../agents/structureAgent";
import type { LiquidityResult } from "../agents/liquidityAgent";
import type { SupplyDemandResult } from "../agents/supplyDemandAgent";
import type { MultiTimeframeResult } from "../agents/multiTimeframeAgent";
import type { NewsMacroResult } from "../agents/newsMacroAgent";
import type { StatisticalSupport } from "@/lib/strategies/supportSummary";
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
  /** Null only when the deployments lookup itself failed. */
  statisticalSupport: StatisticalSupport | null;
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

/**
 * Deployments are the platform's only calibrated record, so they are the only
 * thing G5 may cite. `winRate` is deliberately absent: the deployments table
 * stores calibrated confidence and its interval, not a win rate, and inventing
 * one from the confidence midpoint would manufacture exactly the unvalidated
 * number G5 exists to refuse. Until the backtest cache supplies real win rates,
 * every match grades `uncalibrated` — which is the truth about them.
 */
function strategyMatches(support: StatisticalSupport): StrategyMatch[] {
  const deployments = support.deployments ?? [];
  if (deployments.length === 0 && support.strategyId) {
    return [
      {
        strategyId: support.strategyId,
        sampleSize: support.liveSampleSize ?? 0,
        calibratedConfidence: support.calibratedConfidence,
      },
    ];
  }
  return deployments.map((item) => ({
    strategyId: item.strategyId,
    sampleSize: item.liveSampleSize,
    calibratedConfidence: item.calibratedConfidence,
  }));
}

export interface GateBuildResult {
  gates: GateDefinition[];
  /**
   * Filled in by G5 while the chain runs — the only confidence the plan may
   * claim. Null means no calibrated evidence exists and the plan must be
   * presented without a percentage.
   */
  calibratedConfidence: { value: number | null };
}

export function buildGates(input: GateInputs): GateBuildResult {
  const calibratedConfidence: { value: number | null } = { value: null };

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
            reasonAr: "تعذّر الوصول إلى تقويم الأخبار خلال المهلة.",
          };
        }
        if (input.news.newsRisk === "unknown") {
          return {
            status: "unavailable",
            reasonAr: input.news.reason || "لا يمكن تأكيد نافذة الأخبار حالياً.",
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
            reasonAr: newsBlockReasonAr(verdict) ?? "نافذة خبر عالي التأثير.",
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
          return { status: "unavailable", reasonAr: "خريطة السيولة غير متاحة لهذه الجلسة." };
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
          return { status: "unavailable", reasonAr: "مناطق العرض والطلب غير متاحة." };
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
            reasonAr: "تعذّر قراءة هيكل السوق — لا أساس لبناء خطة.",
          };
        }
        // An HTF conflict does not flip the plan; the direction stays the
        // model's. It costs confidence, which is what disagreement is worth.
        const conflict = input.mtf?.conflict === true;
        const seen = input.visualTimeframes ?? [];
        const blind = seen.length === 0;
        const reasons = [
          conflict
            ? "تعارض بين الفريم الحالي والفريم الأعلى — الخطة قائمة بثقة أقل."
            : null,
          blind ? "لم تتوفر أي لقطة شارت — القراءة من الأرقام وحدها." : null,
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
      // `unavailable` here can mean two very different things, and only one of
      // them is a hazard. If the lookup itself FAILED we do not know what the
      // record says, and a plan issued blind to its own strategy's track record
      // must not go out — that blocks. If the lookup SUCCEEDED and simply found
      // nothing, the backtest pipeline that fills the table is not deployed yet
      // (Phase 4): the same class of standing gap as an unconfigured news feed,
      // which costs confidence and is stated in the plan rather than silencing
      // the platform until the pipeline lands.
      required: input.statisticalSupport == null,
      run: async () => {
        if (!input.statisticalSupport) {
          return {
            status: "unavailable",
            reasonAr: "تعذّر قراءة سجل الاستراتيجيات المُحقّقة.",
          };
        }
        const verdict = gradeStrategyEvidence(strategyMatches(input.statisticalSupport));
        calibratedConfidence.value = confidenceFromEvidence(verdict);
        if (verdict.grade === "none") {
          return {
            status: "unavailable",
            reasonAr: verdict.reasonAr,
            confidenceDelta: -15,
            evidence: { grade: verdict.grade },
          };
        }
        return {
          status: "pass",
          reasonAr: verdict.reasonAr,
          confidenceDelta: verdict.grade === "calibrated" ? 0 : -10,
          evidence: {
            grade: verdict.grade,
            strategyId: verdict.match?.strategyId,
            citableStats: verdict.citableStats ?? null,
          },
        };
      },
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
            reasonAr: `الخطة غير متسقة هندسياً (${problems
              .map((p) => p.code)
              .join("، ")}) — لا تُصدر توصية بخطة تناقض شرط تفعيلها.`,
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
            reasonAr: "تعذّر جلب سعر حي للتحقق النهائي من الخطة.",
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
            reasonAr: verdict.reasonAr ?? "الخطة لم تعد صالحة عند السعر الحي.",
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

  return { gates, calibratedConfidence };
}
