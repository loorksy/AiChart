import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { isAutoExecutionAuthorized } from "@/lib/agent/tradeMode";
import { criticalAlert } from "@/lib/metrics";
import { handleError } from "@/lib/api";
import {
  createIntent,
  hasRecentTradeOpenFailure,
  logAudit,
  resolveBrokerForMarket,
} from "@/lib/store";
import { executeIntent, getRiskBudget } from "@/lib/execution";
import { getEffectiveRevision } from "@/lib/recommendations/canonical/revisions";
import {
  bridgeError,
  bridgeSuccess,
  BridgeErrorCode,
  checkForexTradePreflight,
  getIdempotencyResult,
  readIdempotencyKey,
  storeIdempotencyResult,
  toBridgeResponse,
  type BridgeEnvelope,
} from "@/lib/bridge";
import {
  NON_FOREX_MARKET_MESSAGE,
  DEFAULT_MARKET,
  rejectNonForexMarket,
  resolveActiveMarket,
} from "@/lib/marketPolicy";
import type { MarketType } from "@/lib/markets/types";
import { normalizeIntentSymbol } from "@/lib/markets/resolve";

const schema = z
  .object({
    symbol: z.string().min(1),
    side: z.enum(["buy", "sell"]),
    market: z.literal("forex").optional(),
    entry: z.number().nullish(),
    stop_loss: z.number().positive(),
    take_profit: z.number().nullish(),
    confidence: z.number().min(0).max(100).default(0),
    rationale: z.string().nullish(),
    recommendation_id: z.number().nullish(),
    /** True when the human operator explicitly ordered/approved this trade. */
    approved_by_user: z.boolean().default(false),
    practice: z.boolean().default(false),
    market_type: z.literal("spot").default("spot"),
    order_type: z.enum(["market", "limit"]).default("market"),
    limit_price: z.number().positive().optional(),
    idempotencyKey: z.string().max(128).optional(),
  })
  .strict()
  .refine(
    (b) =>
      !b.approved_by_user ||
      (typeof b.rationale === "string" && b.rationale.trim().length >= 10),
    {
      message:
        "rationale مطلوب (≥10 أحرف) عند approved_by_user — اذكر لماذا ندخل بجملتين.",
    },
  );

function tradeOpenPayload(
  ok: boolean,
  status: string,
  reason: string | undefined,
  intentId: number | null,
  tradeId: number | null | undefined,
  trade: unknown,
) {
  return {
    ok,
    status,
    reason,
    intentId,
    tradeId: tradeId ?? null,
    trade: trade ?? null,
  };
}

async function respondWithIdempotency(
  userId: number,
  key: string | null,
  envelope: BridgeEnvelope,
) {
  if (key) {
    await storeIdempotencyResult(userId, key, envelope);
  }
  return toBridgeResponse(envelope);
}

/**
 * Opens a trade using the account-level Risk per Trade setting. Callers cannot
 * override lots or notional; sizing is recomputed from verified broker equity.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveBridgeUserId(req);
    const body = schema.parse(await req.json());
    const idempotencyKey = readIdempotencyKey(
      req.headers.get("x-idempotency-key"),
      body.idempotencyKey,
    );

    if (idempotencyKey) {
      const cached = await getIdempotencyResult(userId, idempotencyKey);
      if (cached) {
        return toBridgeResponse(cached, { idempotentReplay: true });
      }
    }

    // Failure brake: if a recent attempt on this symbol was denied, reject
    // immediately with a clear reason instead of re-running the full
    // intent → technical execution safety → broker pipeline.
    // It used to be skippable via `approved_by_user` — a body flag the caller
    // (a model, on MCP) writes about itself. Real human approvals no longer
    // travel through this route at all, so nothing here may bypass the brake.
    if (await hasRecentTradeOpenFailure(userId, body.symbol)) {
      const envelope = bridgeSuccess(
        tradeOpenPayload(
          false,
          "denied",
          "failure_brake: a trade on this symbol was denied within the last 15 minutes — do NOT retry; wait or move on to another opportunity",
          null,
          null,
          null,
        ),
      );
      return respondWithIdempotency(userId, idempotencyKey, envelope);
    }

    // An order arrives here from exactly one of two authorisations: the
    // operator approved THIS trade, or they earlier chose the auto mode and
    // this plan's conditions have now been met. There is no third path — the
    // old "autonomous if the strategy is active" route is gone, because whether
    // a trade may be placed is the operator's decision to make, not a
    // statistical property of a strategy (docs/UNIFIED_AGENT_PLAN.md §3).
    // Standing authorisation is the ONLY thing this route can act on. It used to
    // skip this check whenever the body said `approved_by_user: true`, which
    // made a caller's own claim about a human the gate — so the check now runs
    // unconditionally.
    {
      const authorized = await isAutoExecutionAuthorized(userId);
      if (!authorized) {
        criticalAlert("execution_wrong_mode", { source: "trade_open_api", userId });
        const envelope = bridgeSuccess(
          tradeOpenPayload(
            false,
            "denied",
            "لا يوجد تفويض للتنفيذ: هذا المسار يعمل بالتفويض التلقائي القائم فقط. الموافقة اليدوية تمر عبر طلب اعتماد يوافق عليه المستخدم بنفسه (approval flow) — لا عبر حقل في الطلب.",
            null,
            null,
            null,
          ),
        );
        return respondWithIdempotency(userId, idempotencyKey, envelope);
      }
    }

    const requestedMarket = body.market ?? DEFAULT_MARKET;
    const marketBlock = rejectNonForexMarket(requestedMarket);
    if (marketBlock) {
      const envelope = bridgeSuccess(
        tradeOpenPayload(false, "denied", marketBlock, null, null, null),
      );
      return respondWithIdempotency(userId, idempotencyKey, envelope);
    }
    const market = resolveActiveMarket(requestedMarket) as MarketType;

    const preflight = await checkForexTradePreflight(userId, body.symbol);
    if (preflight) {
      await logAudit(
        userId,
        "agent_trade_open",
        `${body.symbol} ${body.side} denied ${preflight.error.code} (pre-flight)`,
      );
      return respondWithIdempotency(userId, idempotencyKey, preflight);
    }

    const orderType = body.order_type ?? "market";

    const broker = await resolveBrokerForMarket(userId, market);
    const budget = await getRiskBudget(userId, broker);
    if (!budget) {
      const envelope = bridgeError(
        BridgeErrorCode.VALIDATION_ERROR,
        "Verified broker equity is unavailable.",
        "تعذّر التحقق من equity للحساب المتصل؛ لم يُرسل أي أمر.",
      );
      return respondWithIdempotency(userId, idempotencyKey, envelope);
    }

    const leverage = 1;

    // The revision the referenced plan is on RIGHT NOW, so the execution-time
    // compare-and-swap has a number to hold the order to. Null when the trade
    // references no recommendation, or a pre-revision one.
    const effectiveRevision =
      body.recommendation_id != null
        ? await getEffectiveRevision(userId, body.recommendation_id).catch(() => null)
        : null;

    const intent = await createIntent(userId, {
      recommendation_id: body.recommendation_id ?? null,
      recommendation_revision_no: effectiveRevision?.revisionNo ?? null,
      // Which of the two authorisations brought us here (checked above): the
      // operator approving THIS trade, or their standing auto mode — which the
      // execution choke point re-verifies at the moment the order is placed.
      // Always `standing_auto`. This route's caller composes its own body — on
      // the MCP surface that caller is a model — so `approved_by_user` cannot
      // mint a `user_approved` intent here. A real per-trade approval is created
      // as a PENDING intent and turned into an executable one by the
      // authenticated approval path (`respondToApproval`), which is what writes
      // the server-side proof the choke point demands.
      authorization_source: "standing_auto",
      symbol: normalizeIntentSymbol(body.symbol, market),
      side: body.side,
      notional: budget.riskAmount,
      market,
      broker,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: body.take_profit ?? null,
      confidence: body.confidence,
      rationale: body.rationale ?? null,
      status: "approved",
      practice: body.practice,
      market_type: "spot",
      leverage,
      order_type: orderType,
      limit_price: body.limit_price ?? null,
    });

    const result = await executeIntent(userId, intent.id, {
      // Never from the body: this route cannot prove a human approved anything.
      explicitApproval: false,
      practiceMode: body.practice,
    });

    if (result.errorCode === BridgeErrorCode.UPSTREAM_TIMEOUT) {
      const timeoutEnvelope = bridgeError(
        BridgeErrorCode.UPSTREAM_TIMEOUT,
        result.reason,
        result.reason,
        { symbol: intent.symbol, intentId: intent.id },
        { retriable: true, retryAfterMs: 3000 },
      );
      await logAudit(
        userId,
        "agent_trade_open",
        `${intent.symbol} ${intent.side} denied UPSTREAM_TIMEOUT`,
      );
      return respondWithIdempotency(userId, idempotencyKey, timeoutEnvelope);
    }

    await logAudit(
      userId,
      "agent_trade_open",
      `${intent.symbol} ${intent.side} risk=${budget.riskAmount.toFixed(2)} ${budget.currency ?? "account"} → ${result.status}${result.ok ? "" : ` (${result.reason})`}`,
    );

    const envelope = bridgeSuccess(
      tradeOpenPayload(
        result.ok,
        result.status,
        result.reason,
        intent.id,
        result.tradeId,
        result.trade,
      ),
    );
    return respondWithIdempotency(userId, idempotencyKey, envelope);
  } catch (e) {
    return handleError(e);
  }
}
