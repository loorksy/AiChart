import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import { collectTakeProfits } from "@/lib/recommendations/collectTakeProfits";
import {
  canonicalStrategySymbol,
  storageStrategyTimeframe,
} from "@/lib/strategies/matchingKeys";
import {
  activationRuleSchema,
  normalizeActivationRule,
} from "@/lib/recommendations/activationRule";
import { runClientPlanGateChain } from "@/lib/agent/gates/clientPlanChain";
import { GATE_RECORD_MAX_AGE_MS } from "@/lib/recommendations/gateRecords";
import { normalizeTimeframesReviewed } from "@/lib/recommendations/visualConfirmation";
import { logAudit } from "@/lib/store";
import { createLogger } from "@/lib/logger";

const log = createLogger("api.agent.gates.run");

/**
 * Bridge: run the platform's mandatory G1–G7 gate chain over a plan the
 * CLIENT model authored, in forced order, in this one call — and record the
 * verdicts so the analysis id can authorize (or be refused at) the write
 * boundary. Zero platform LLM spend: every gate input is deterministic.
 *
 * The schema mirrors `create_recommendation`'s plan fields on purpose: the
 * client states ONE plan, runs it through the gates here, then submits the
 * same plan with the returned analysis_id. invalidation_rule and
 * alternative_scenario are accepted as part of that plan statement; no gate
 * reads them — their completeness is enforced at the write boundary, one
 * voice, exactly as before.
 */
const schema = z
  .object({
    symbol: z.string().min(1),
    timeframe: z.string().default("1h"),
    direction: z.enum(["buy", "sell"]),
    entry: z.number().positive(),
    stop_loss: z.number().positive(),
    take_profit: z.number().positive().nullish(),
    take_profits: z.array(z.number().positive()).max(3).optional(),
    /** The client's declared fill semantics — resolved by structure server-side. */
    entry_type: z.string().max(32).nullish(),
    plan_type: z.enum(["immediate", "anticipatory", "conditional"]).nullish(),
    // Part of the plan statement (accepted so ONE plan object serves this call
    // and the create); no gate reads a zone bound — G6/G7 grade the nominal
    // entry, exactly as the platform's own chain does.
    entry_low: z.number().positive().nullish(),
    entry_high: z.number().positive().nullish(),
    activation_condition: z.string().trim().min(8).max(400).nullish(),
    activation_rule: activationRuleSchema.nullish(),
    invalidation_rule: z.string().trim().min(8).max(400).nullish(),
    alternative_scenario: z.string().trim().min(8).max(400).nullish(),
    validity_candles: z.number().int().min(1).max(96).nullish(),
    /** Chart frames the client actually reviewed — G4's honesty evidence. */
    timeframes_reviewed: z.array(z.string().min(1).max(16)).max(8).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (
      collectTakeProfits(body.direction, body.take_profit, body.take_profits)
        .length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["take_profit"],
        message: "take_profit (or take_profits) is required — a plan without a target cannot be gated",
      });
    }
  });

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const symbol = canonicalStrategySymbol(body.symbol);
    const timeframe = storageStrategyTimeframe(body.timeframe);
    const targets = collectTakeProfits(
      body.direction,
      body.take_profit,
      body.take_profits,
    );
    // The same mechanical default the write applies: a rule naming no
    // timeframe gets the plan's own, so the chain grades the rule that will
    // actually be stored — never a differently-defaulted twin.
    const activationRule = body.activation_rule
      ? normalizeActivationRule(body.activation_rule, timeframe)
      : null;

    const result = await runClientPlanGateChain({
      userId,
      symbol,
      interval: timeframe,
      plan: {
        direction: body.direction,
        declaredEntryType: body.entry_type ?? null,
        planType: body.plan_type ?? null,
        entry: body.entry,
        stopLoss: body.stop_loss,
        targets,
        activationRule,
      },
      visualTimeframes: normalizeTimeframesReviewed(body.timeframes_reviewed),
    });

    log.info("client plan gate chain", {
      userId,
      analysisId: result.analysisId,
      allowed: result.allowed,
      vetoedBy: result.vetoedBy?.id ?? null,
    });
    await logAudit(
      userId,
      "agent_gate_chain",
      `${result.symbol} ${body.direction} gates ${result.allowed ? "allowed" : `refused by ${result.vetoedBy?.id ?? "?"}`} (${result.analysisId})`,
    ).catch(() => {});

    return NextResponse.json({
      ok: true,
      allowed: result.allowed,
      analysis_id: result.analysisId,
      symbol: result.symbol,
      timeframe: result.interval,
      /** The canonical fill semantics the chain graded — what the write stores. */
      entry_type: result.entryType,
      verdicts: result.verdicts.map((v) => ({
        gate: v.id,
        name: v.name,
        status: v.status,
        reason_ar: v.reasonAr ?? null,
        confidence_delta: v.confidenceDelta ?? 0,
        evidence: v.evidence ?? null,
      })),
      confidence_delta: result.confidenceDelta,
      current_price: result.currentPrice,
      atr: result.atr,
      market_open: result.marketOpen,
      // The refusal is the platform's answer, never an HTTP error: it names
      // the gate that fell and why, so the client knows what to wait for.
      refusal: result.allowed
        ? null
        : {
            gate: result.vetoedBy?.id ?? null,
            name: result.vetoedBy?.name ?? null,
            status: result.vetoedBy?.status ?? null,
            reason_ar: result.vetoedBy?.reasonAr ?? null,
            summary_ar: result.refusalAr,
          },
      records_expire_in_seconds: Math.round(GATE_RECORD_MAX_AGE_MS / 1000),
      next_step: result.allowed
        ? `Call create_recommendation with analysis_id=${result.analysisId} and the SAME plan within ${Math.round(GATE_RECORD_MAX_AGE_MS / 1000)}s — stale records refuse the write.`
        : "Do not call create_recommendation with this analysis_id — the recorded chain refused it. Address the named gate (or wait it out) and run the gates again.",
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const issues = e.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`);
      return NextResponse.json(
        {
          error: issues.join("; "),
          hint: "Fix ONLY the fields above and call again.",
        },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}
