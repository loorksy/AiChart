/**
 * Standing-authorisation execution (docs/UNIFIED_AGENT_PLAN.md §3).
 *
 * When a plan the operator authorised in `auto` mode reaches its activation
 * condition, this places it. That is the whole scope: it decides nothing about
 * the market, never adjusts a level, and never overrides a condition the plan
 * set for itself.
 *
 * Every order goes through `executeIntent`, so the kill switch, portfolio gate,
 * readiness checks, verified-equity sizing, and the effective-revision check all
 * apply exactly as they do to a manually approved trade. Auto mode authorises
 * WHO decided to trade, not WHETHER the technical checks run.
 *
 * ROLLOUT STAGES — `AUTO_EXECUTION_STAGE`:
 *   off      (default) nothing is placed at all;
 *   dry_run  decide and record and notify, but send no order;
 *   demo     place only on a broker account reporting demo;
 *   live     place on any authorised account.
 * The default is `off`: turning real money on is an operator decision, never a
 * consequence of deploying this file.
 */
import { createIntent } from "@/lib/store";
import { executeIntent } from "@/lib/execution";
import { getResolvedExecutionEnv } from "@/lib/executionEnv";
import { isAutoExecutionAuthorized } from "@/lib/agent/tradeMode";
import { criticalAlert } from "@/lib/metrics";
import { createLogger } from "@/lib/logger";
import type { LifecycleEvent } from "./lifecycleEvents";
import type { TrackedRecommendation } from "./types";

const log = createLogger("auto-executor");

export type AutoExecutionStage = "off" | "dry_run" | "demo" | "live";

export function autoExecutionStage(): AutoExecutionStage {
  const raw = (process.env.AUTO_EXECUTION_STAGE ?? "").trim().toLowerCase();
  if (raw === "dry_run" || raw === "demo" || raw === "live") return raw;
  return "off";
}

/**
 * A ceiling on how many orders standing authorisation may place per day.
 *
 * Purely operational: it protects against a runaway loop or an unusually noisy
 * session, and it is deliberately separate from the analytical limits, which
 * belong to the portfolio gate.
 */
export function autoExecutionDailyCap(): number {
  const raw = Number(process.env.AUTO_EXECUTION_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 6;
}

export type AutoExecutionOutcome =
  | { placed: false; reason: string; code: AutoSkipCode }
  | { placed: true; intentId: number; tradeId?: number; dryRun: boolean };

export type AutoSkipCode =
  | "stage_off"
  | "not_authorized"
  | "not_activated"
  | "plan_incomplete"
  | "daily_cap"
  | "wrong_account_type"
  | "execution_failed";

export interface AutoExecuteInput {
  recommendation: TrackedRecommendation;
  /** The activation event from this sweep, if any. */
  events: LifecycleEvent[];
  /** Orders already placed automatically today, for the operational cap. */
  placedToday?: number;
}

/**
 * Consider one recommendation for automatic execution.
 *
 * Only an activation event triggers this: a plan the operator can already enter
 * manually is theirs to take, and a plan still waiting on its condition is not
 * ready by its own terms.
 */
export async function maybeAutoExecute(
  input: AutoExecuteInput,
): Promise<AutoExecutionOutcome> {
  const stage = autoExecutionStage();
  if (stage === "off") {
    return { placed: false, reason: "auto execution stage is off", code: "stage_off" };
  }

  const rec = input.recommendation;
  const activated = input.events.some((event) => event.type === "activated");
  if (!activated) {
    return {
      placed: false,
      reason: "the plan has not reached its activation condition",
      code: "not_activated",
    };
  }

  if (!(await isAutoExecutionAuthorized(rec.userId))) {
    // A standing-auto attempt without a live grant is the invariant this counter
    // pages on. Reaching here through normal flow (mode dropped mid-sweep) is
    // exactly the case the operator must hear about.
    criticalAlert("execution_wrong_mode", { source: "auto_executor", userId: rec.userId });
    return {
      placed: false,
      reason: "the operator has not authorised standing execution on this connection",
      code: "not_authorized",
    };
  }

  if (!(rec.entry > 0) || !(rec.stopLoss > 0) || !rec.targets.length) {
    // Without a stop there is no sizing and no risk bound. A plan missing one
    // is never completed here — the agent is asked for a full plan instead.
    return {
      placed: false,
      reason: "the plan has no complete entry/stop/target set",
      code: "plan_incomplete",
    };
  }

  const cap = autoExecutionDailyCap();
  if ((input.placedToday ?? 0) >= cap) {
    return {
      placed: false,
      reason: `daily automatic execution cap reached (${cap})`,
      code: "daily_cap",
    };
  }

  if (stage === "demo") {
    const env = await getResolvedExecutionEnv(rec.userId, "forex").catch(() => null);
    if (env !== "demo") {
      return {
        placed: false,
        reason: "auto execution is limited to demo accounts at this rollout stage",
        code: "wrong_account_type",
      };
    }
  }

  if (stage === "dry_run") {
    // The decision is real and recorded; only the order is withheld. This is
    // how the engine earns trust before it is allowed to spend money.
    log.info("auto.dry_run", {
      userId: rec.userId,
      symbol: rec.symbol,
      direction: rec.direction,
      entry: rec.entry,
      revisionNo: rec.revisionNo ?? null,
    });
    return { placed: true, intentId: -1, dryRun: true };
  }

  const intent = await createIntent(rec.userId, {
    recommendation_id: Number.isFinite(Number(rec.id)) ? Number(rec.id) : null,
    recommendation_revision_no: rec.revisionNo ?? null,
    authorization_source: "standing_auto",
    symbol: rec.symbol,
    side: rec.direction,
    // Sizing is the server's job from verified equity; this is a placeholder
    // the execution path replaces, never a size the agent chose.
    notional: 0,
    entry: rec.entry,
    stop_loss: rec.stopLoss,
    take_profit: rec.targets[0] ?? null,
    rationale: `تنفيذ تلقائي بعد تحقق شرط تفعيل التوصية ${rec.id}`,
  });

  const result = await executeIntent(rec.userId, intent.id, {
    // NOT explicit approval: this is standing authorisation, and the
    // distinction is preserved so the audit trail stays truthful.
    explicitApproval: false,
  });

  if (!result.ok) {
    log.warn("auto.execute.failed", {
      userId: rec.userId,
      symbol: rec.symbol,
      reason: result.reason.slice(0, 200),
    });
    return { placed: false, reason: result.reason, code: "execution_failed" };
  }

  return { placed: true, intentId: intent.id, tradeId: result.tradeId, dryRun: false };
}
