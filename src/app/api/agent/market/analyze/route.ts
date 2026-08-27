import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  getSettings,
  getLimits,
  getTodayUsage,
  incrementUsage,
  logAudit,
  isDailyQuotaEnforced,
  saveChartLayout,
  getChartLayoutById,
} from "@/lib/store";
import {
  isLLMConfiguredAsync,
  resolveUserModelSelection,
  withRequestModel,
} from "@/lib/llm";
import { withUsageContext } from "@/lib/billing/usageMeter";
import { resolveSpendGate } from "@/lib/billing/spend";
import { presentRefusal } from "@/lib/billing/refusal";
import { resolveUserLocale } from "@/lib/i18n/userLocale";
import { t as translate } from "@/lib/i18n";
import { acquireAnalyzeSlot } from "@/lib/analyzeGuard";
import { INTERVAL_SET } from "@/lib/intervals";
import { forexCanonicalKey } from "@/lib/markets/forexCanonical";
import { runUnifiedChartAgent } from "@/lib/agent/orchestrator";
import {
  deriveRecommendationReason,
  shouldChargeAnalysis,
} from "@/lib/agent/analysisAccounting";
import { newId } from "@/lib/agent/activity";
import { inboundTraceId } from "@/lib/traceCorrelation";
import { DEFAULT_MARKET, rejectNonForexMarket, resolveActiveMarket } from "@/lib/marketPolicy";
import type { Recommendation } from "@/lib/types";
import { planTargetList } from "@/lib/chart/planTargets";

export const maxDuration = 300;
const ANALYSIS_COST = 4;

const schema = z.object({
  symbol: z.string().min(3).max(20).optional(),
  interval: z.string().min(2).max(4).optional().refine(
    (value) => value == null || INTERVAL_SET.has(value),
    "إطار زمني غير مدعوم",
  ),
  market: z.string().optional(),
  data_source: z.enum(["oanda"]).optional(),
  layout_id: z.string().regex(/^[A-Za-z0-9]{8,16}$/).optional(),
});

/** All authenticated connector analysis uses the same canonical chat agent. */
export async function POST(req: NextRequest) {
  let release: (() => void) | null = null;
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    if (!(await isLLMConfiguredAsync())) {
      return NextResponse.json({ error: "الذكاء الاصطناعي غير مفعّل على الخادم." }, { status: 503 });
    }

    const limits = await getLimits(userId);
    const used = await getTodayUsage(userId);
    if (isDailyQuotaEnforced() && limits.claude_quota > 0 && used + ANALYSIS_COST > limits.claude_quota) {
      return NextResponse.json(
        { error: "الرصيد غير كافٍ لتحليل جديد.", code: "credits_required", remaining: Math.max(0, limits.claude_quota - used) },
        { status: 429 },
      );
    }

    const slot = acquireAnalyzeSlot(userId);
    if (!slot.ok) {
      return NextResponse.json(
        { error: slot.reason === "in_flight" ? "لديك تحليل قيد التنفيذ بالفعل." : "المنصة مشغولة حالياً؛ أعد المحاولة خلال ثوانٍ.", code: slot.reason },
        { status: slot.reason === "in_flight" ? 429 : 503 },
      );
    }
    release = slot.release;

    const layout = body.layout_id ? await getChartLayoutById(body.layout_id, userId) : null;

    let symbol = (body.symbol ?? layout?.symbol ?? "").toUpperCase().trim();
    if (!symbol) return NextResponse.json({ error: "symbol is required." }, { status: 400 });
    const interval = body.interval ?? layout?.interval ?? "5m";
    const marketError = rejectNonForexMarket(body.market);
    if (marketError) return NextResponse.json({ error: marketError }, { status: 400 });
    resolveActiveMarket(body.market ?? DEFAULT_MARKET);

    // Candles come from the platform OANDA feed; the canonical chart key
    // is resolved to the feed's spelling downstream.
    const dataSource = "oanda" as const;
    symbol = forexCanonicalKey(symbol);

    // A closed market no longer refuses (this was a 409 twin of the
    // orchestrator's deleted early return). The orchestrator now runs in
    // scenario mode on the last close and answers with a conditional
    // next-open plan — a real, billable analysis the caller asked for, so it
    // proceeds through the spend gate like any other.

    // Billing v3 preflight: an analysis exists to produce a recommendation,
    // so it is gated by the SAME three account states creation enforces —
    // refusing here saves the model spend a doomed creation would waste.
    const gate = await resolveSpendGate(userId, "recommendation");
    if (!gate.allowed) {
      // Structured for the model to READ and relay: the code names the
      // state, the action names the step (subscribe vs top up vs renew),
      // and the message is the same sentence every other surface shows.
      const view = presentRefusal(await resolveUserLocale(userId), gate);
      return NextResponse.json(
        {
          ok: false,
          error: { code: gate.code, action: gate.action, message: view.message },
          failure_code: gate.code,
        },
        { status: gate.code === "insufficient_credits" ? 402 : 403 },
      );
    }

    // The same per-user model choice applies when the request arrives through
    // MCP: the operator picked a brain, not a transport.
    const modelSelection = await resolveUserModelSelection(
      (await getSettings(userId)).preferred_model_ref,
    );
    const result = await withUsageContext({ userId, kind: "analysis" }, () =>
      withRequestModel(modelSelection, () => runUnifiedChartAgent({
      // The parity surface is the BRAIN that decided, not the transport that
      // asked. This route runs `runUnifiedChartAgent` — the platform decision
      // engine — so it records as `platform` even though an MCP tool proxied
      // here. Labelling it `mcp` compared the platform engine against itself
      // (vacuous), and simultaneously collided with the one producer that can
      // genuinely diverge: the MCP-hosted model writing its own plan through
      // `create_recommendation`. That is what `mcp` now means, and the ordinary
      // Claude flow — analyse, then create — produces both halves of a real
      // pair on the same symbol and candle.
      surface: "platform",
      liveSession: true,
      userMessage: `حلّل ${symbol} على إطار ${interval} كفرصة سكالب واشرح قرارك.`,
      chartContext: { symbol, interval, layoutId: body.layout_id, dataSource },
      requestContext: {
        // Honour an inbound MCP correlation id so one trace spans
        // MCP call -> web request -> agent stages -> research job
        // (RELIABILITY_PLAN.md item 9). It is echoed back as envelope.trace_id.
        requestId: inboundTraceId(req) ?? newId(),
        userId,
        emitActivity: () => {},
        // Client disconnect (MCP tool gave up / caller aborted) must tear the
        // provider work down, not leave it running (RELIABILITY_PLAN item 2).
        signal: req.signal,
      },
      account: null,
      canExecute: false,
    })));
    const recommendation = result.recommendation;
    const tps = planTargetList({
      targets: recommendation?.targets,
      takeProfit: recommendation?.take_profit ?? recommendation?.targets?.[0] ?? null,
    });
    const mapped: Recommendation | null = recommendation && (recommendation.action === "buy" || recommendation.action === "sell")
      ? ({
          symbol,
          action: recommendation.action,
          entry: recommendation.entry ?? null,
          stop_loss: recommendation.stop_loss ?? null,
          take_profit: recommendation.take_profit ?? tps[0] ?? null,
          targets: tps,
          confidence: Math.round(result.confidence * 100),
          timeframe: interval,
          // The chart anchors the profit/loss zones at this instant. Persisted
          // with the layout below so every re-render, poll, and reload reuses
          // the SAME anchor instead of re-anchoring to "now" (the reported
          // zones-slide-with-the-candle bug).
          created_at: new Date().toISOString(),
        } as Recommendation)
      : null;

    // Accounting policy (RELIABILITY_PLAN.md item 8): an operational blocker
    // is the platform's failure — the operator is NOT charged for it.
    const charged = shouldChargeAnalysis(result.envelope);
    const chargeAmount = charged ? ANALYSIS_COST : 0;
    if (charged) await incrementUsage(userId, ANALYSIS_COST);
    await logAudit(
      userId,
      "market_analyze",
      `${symbol}@${interval} decision=${result.decision} outcome=${result.envelope?.outcome_class ?? "unknown"} charged=${charged}`,
    );

    // applied_to_chart must reflect what actually happened — a failed layout
    // save is reported as a non-critical warning, never claimed as success.
    let appliedToChart = false;
    let layoutSaveError: string | undefined;
    if (body.layout_id) {
      try {
        await saveChartLayout(body.layout_id, userId, {
          symbol,
          interval,
          state: {
            drawings: result.drawings ?? [],
            overlays: [],
            recommendation: mapped,
            targets: tps,
            dataSource,
          },
        });
        appliedToChart = true;
      } catch {
        layoutSaveError = "layout_save_failed";
      }
    }

    return NextResponse.json({
      reply: result.summary,
      // The recorded gate chain's key: create_recommendation must echo this
      // back or the write is refused (gate records are checked in code).
      analysis_id: result.analysisId ?? null,
      recommendation: mapped,
      ...(mapped
        ? {}
        : { recommendation_reason: deriveRecommendationReason(result.decision, result.envelope) }),
      targets: tps,
      drawings: result.drawings ?? [],
      overlays: [],
      activityEvents: result.activityEvents,
      decision: result.decision,
      envelope: result.envelope,
      // Deferred #16: the execution-cost contract, unit-named keys and explicit
      // source/fallback. unavailable is stated, never rendered as zero.
      cost_evidence: result.costEvidence ?? null,
      newsRisk: result.newsRisk,
      requiresConfirmation: result.requiresConfirmation ?? false,
      data_source: dataSource,
      quota: {
        used: used + chargeAmount,
        limit: limits.claude_quota,
        remaining: Math.max(0, limits.claude_quota - used - chargeAmount),
      },
      ...(body.layout_id
        ? {
            layout_id: body.layout_id,
            applied_to_chart: appliedToChart,
            ...(layoutSaveError ? { warnings: [layoutSaveError] } : {}),
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "بيانات غير صالحة." }, { status: 400 });
    }
    return handleError(error);
  } finally {
    release?.();
  }
}
