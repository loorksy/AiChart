/**
 * The stale-scenario reprice loop — a G7 "the move already happened" veto
 * becomes ONE corrective resynthesis instead of a published refusal.
 *
 * The incident (2026-08-26, production): the synthesizer authored an XAUUSD
 * plan whose stop (4608.13) the live price had already passed. G7 correctly
 * said the authored idea was stale — and the orchestrator turned that veto
 * straight into a "no recommendation right now" answer with an empty 0% card.
 * But "the stop is already behind price" is not a fact about THE MARKET being
 * untradeable; it is a fact about WHICH SCENARIO PLAYED OUT while the
 * analysis ran. The move
 * the plan was waiting for already occurred. That is information the decision
 * engine should act on — enter the follow-through at the market that exists
 * now, or write a new conditional at the current structure — not a reason to
 * stand aside.
 *
 * So the loop: when the chain's veto is G7 with a stale-scenario status
 * (`invalidated` / `targets_passed`), build an explicit feedback block naming
 * the live price, the overtaken levels and the choice to make, run the
 * synthesizer ONCE more with it, and re-run the same G1–G7 chain over the new
 * plan. The refusal survives only when the retry itself fails the gates — or
 * when the veto was never scenario-staleness at all (news blackout, missing
 * calendar, incoherent geometry), which stays a refusal by name.
 */
import type { GateChainResult } from "./types";

/**
 * G7 statuses that mean "the anticipated move already occurred". Everything
 * else a gate can say (news window, incoherent plan, no live quote, degraded
 * RR floor) is not a repriceable fact and keeps its refusal.
 */
const STALE_SCENARIO_STATUSES = new Set(["invalidated", "targets_passed"]);

/** The plan the vetoed chain graded — the numbers the feedback names. */
export interface StaleScenarioPlan {
  direction: "buy" | "sell";
  entry: number;
  stopLoss: number;
  targets: number[];
}

/** True when this refusal is really scenario information in disguise. */
export function isStaleScenarioVeto(chain: GateChainResult): boolean {
  const veto = chain.vetoedBy;
  if (!veto || veto.id !== "G7" || veto.status !== "veto") return false;
  const status = veto.evidence?.status;
  return typeof status === "string" && STALE_SCENARIO_STATUSES.has(status);
}

/**
 * The corrective block the retry carries — the system-prompt language is
 * English, like every other instruction the model receives. It states what
 * happened as scenario evidence and demands a plan priced against the market
 * that exists NOW, explicitly offering both follow-through shapes (immediate
 * and conditional) while leaving direction authority with the model.
 */
export function staleScenarioFeedback(input: {
  chain: GateChainResult;
  plan: StaleScenarioPlan;
}): string | null {
  if (!isStaleScenarioVeto(input.chain)) return null;
  const veto = input.chain.vetoedBy!;
  const status = String(veto.evidence?.status);
  const rawPrice = veto.evidence?.currentPrice;
  const livePrice = typeof rawPrice === "number" && Number.isFinite(rawPrice) ? rawPrice : null;
  const { direction, entry, stopLoss, targets } = input.plan;

  const happened =
    status === "targets_passed"
      ? `the live price${livePrice != null ? ` (${livePrice.toFixed(2)})` : ""} is already beyond every target (${targets
          .map((t) => t.toFixed(2))
          .join(", ")}) — the move the plan anticipated has ALREADY COMPLETED`
      : `the live price${livePrice != null ? ` (${livePrice.toFixed(2)})` : ""} is already at or beyond the stop (${stopLoss.toFixed(
          2,
        )}) — the market has already resolved the level the plan was built around`;

  return [
    `# LIVE-PRICE REVALIDATION FEEDBACK — your previous plan was overtaken by the market`,
    `Your previous decision proposed a ${direction} plan (entry ${entry.toFixed(2)}, stop ${stopLoss.toFixed(2)}, targets ${targets
      .map((t) => t.toFixed(2))
      .join(", ")}), but ${happened}.`,
    `This is INFORMATION about which scenario played out while you were analyzing — not a reason to stand aside. Re-read the market as it is NOW and issue a fresh, actionable decision:`,
    `- If the move confirmed your read and structure supports continuation: an IMMEDIATE entry at the current price, or a retest entry at the level just broken, with stop and targets from the evidence menu around the CURRENT price.`,
    `- If the previous plan was CONDITIONAL and the live price has already gone through its entry in the trade's profit direction (a sell sitting below a waited-for entry, a buy sitting above one): that wait is over. Issue IMMEDIATE follow-through at current structure — never re-emit "wait for a level the market already left".`,
    `- Otherwise: a NEW conditional plan whose trigger and levels sit correctly relative to the live price.`,
    `- If the evidence after this move genuinely favors the opposite side, say so and plan that side — the direction is yours.`,
    `Do NOT re-emit the previous levels: any stop or trigger the live price has already passed will be refused again.`,
  ].join("\n");
}

export interface StaleRepriceInput<D> {
  /** The decision the vetoed chain graded. */
  decision: D;
  /** The refused chain. */
  chain: GateChainResult;
  /** The graded plan's levels, for the feedback text. */
  plan: StaleScenarioPlan;
  /**
   * One corrective resynthesis carrying the feedback block. Null (model
   * failure, deadline, or a retry decision with no gateable levels) keeps the
   * original refusal — the retry is best-effort, never a new failure mode.
   */
  resynthesize: (feedback: string) => Promise<D | null>;
  /**
   * The SAME G1–G7 evaluation the original decision went through, over the
   * retry decision. Null when the retry decision cannot be gated at all.
   */
  evaluate: (decision: D) => Promise<GateChainResult | null>;
}

export interface StaleRepriceOutcome<D> {
  decision: D;
  chain: GateChainResult;
  /** True when the retry decision replaced the original (its chain may still refuse). */
  repriced: boolean;
  /** The feedback the retry received; null when this veto was not repriceable. */
  feedback: string | null;
}

/**
 * At most ONE reprice round, by design: the feedback names the live price and
 * forbids the stale levels, so a second identical failure means the model
 * cannot produce a gateable plan for this market — and that refusal is honest.
 */
export async function repriceStaleScenario<D>(
  input: StaleRepriceInput<D>,
): Promise<StaleRepriceOutcome<D>> {
  const kept: StaleRepriceOutcome<D> = {
    decision: input.decision,
    chain: input.chain,
    repriced: false,
    feedback: null,
  };
  if (input.chain.allowed) return kept;
  const feedback = staleScenarioFeedback({ chain: input.chain, plan: input.plan });
  if (!feedback) return kept;

  const retry = await input.resynthesize(feedback);
  if (retry == null) return { ...kept, feedback };
  const retryChain = await input.evaluate(retry);
  if (retryChain == null) return { ...kept, feedback };

  // Adopted even when the retry chain refuses: the refusal then names the
  // RETRY plan's gate — the honest answer after the reprice was attempted —
  // instead of a veto about levels the pipeline already knows are stale.
  return { decision: retry, chain: retryChain, repriced: true, feedback };
}
