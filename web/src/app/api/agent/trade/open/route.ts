import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveBridgeUserId } from "@/lib/agentAuth";
import { handleError } from "@/lib/api";
import {
  createIntent,
  getBinanceCredentials,
  getLimits,
  getSettings,
  hasRecentTradeOpenFailure,
  logAudit,
} from "@/lib/store";
import { executeIntent, bridgeEnvelopeForExecutionDenial } from "@/lib/execution";
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
import { getAccountSummary, getApiRestrictions } from "@/lib/binance";
import { getEaSymbolSpec } from "@/lib/eaStore";
import { futuresPermissionBlockReason } from "@/lib/binanceVerify";
import type { MarketType } from "@/lib/markets/types";
import { normalizeIntentSymbol } from "@/lib/markets/resolve";

const schema = z
  .object({
    symbol: z.string().min(1),
    side: z.enum(["buy", "sell"]),
    /** Quote amount (USDT) — defaults to per-trade budget from settings. */
    notional: z.number().positive().optional(),
    /** Forex: explicit lot size — overrides notional-based sizing when set. */
    lots: z.number().positive().max(100).optional(),
    market: z.enum(["crypto", "forex"]).optional(),
    entry: z.number().nullish(),
    stop_loss: z.number().nullish(),
    take_profit: z.number().nullish(),
    confidence: z.number().min(0).max(100).default(0),
    rationale: z.string().nullish(),
    recommendation_id: z.number().nullish(),
    /** True when the human operator explicitly ordered/approved this trade. */
    approved_by_user: z.boolean().default(false),
    practice: z.boolean().default(false),
    /** 'futures' opens a Binance USDT-M position (short + leverage supported). */
    market_type: z.enum(["spot", "futures"]).default("spot"),
    /** Leverage multiplier (futures only; capped by admin max_leverage_cap). */
    leverage: z.number().min(1).max(125).optional(),
    /** 'market' (default) or 'limit' (futures pending entry). */
    order_type: z.enum(["market", "limit"]).default("market"),
    /** Required when order_type is limit. */
    limit_price: z.number().positive().optional(),
    /** Optional idempotency key — replays cached result within TTL. */
    idempotencyKey: z.string().max(128).optional(),
  })
  .refine(
    (b) =>
      b.order_type !== "limit" ||
      (b.market_type === "futures" && b.limit_price != null),
    { message: "limit_price مطلوب لأوامر Limit في Futures." },
  )
  .refine((b) => b.order_type !== "limit" || b.market_type === "futures", {
    message: "أوامر Limit متاحة في Futures فقط.",
  })
  .refine(
    (b) =>
      !b.approved_by_user ||
      (b.notional != null && b.notional > 0),
    {
      message:
        "notional مطلوب عند approved_by_user — اسأل المشغّل «بكم ندخل؟» ولا تستخدم الحد الافتراضي.",
    },
  )
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
 * Bridge: opens a real trade. Every call runs the full intent → Risk Guard →
 * broker pipeline; the Risk Guard can deny regardless of who asked.
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
    // intent → Risk Guard → broker pipeline (stops wasted AI retry loops).
    // Explicit human approval bypasses the brake.
    if (
      !body.approved_by_user &&
      (await hasRecentTradeOpenFailure(userId, body.symbol))
    ) {
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

    const settings = await getSettings(userId);
    const limits = await getLimits(userId);
    const market = (body.market ??
      settings.active_market ??
      "crypto") as MarketType;

    if (market === "forex") {
      const preflight = await checkForexTradePreflight(userId, body.symbol);
      if (preflight) {
        await logAudit(
          userId,
          "agent_trade_open",
          `${body.symbol} ${body.side} denied ${preflight.error.code} (pre-flight)`,
        );
        return respondWithIdempotency(userId, idempotencyKey, preflight);
      }
    }

    const marketType = body.market_type ?? "spot";
    const orderType = body.order_type ?? "market";

    if (marketType === "futures") {
      const creds = await getBinanceCredentials(userId);
      if (!creds) {
        const envelope = bridgeSuccess(
          tradeOpenPayload(
            false,
            "denied",
            "لا يوجد حساب Binance مرتبط.",
            null,
            null,
            null,
          ),
        );
        return respondWithIdempotency(userId, idempotencyKey, envelope);
      }
      if (creds.env === "prod") {
        const summary = await getAccountSummary(
          creds.apiKey,
          creds.apiSecret,
          creds.env,
        );
        const restrictions = await getApiRestrictions(
          creds.apiKey,
          creds.apiSecret,
          creds.env,
        );
        const block = futuresPermissionBlockReason(
          summary,
          restrictions,
          creds.env,
        );
        if (block) {
          const envelope = bridgeSuccess(
            tradeOpenPayload(false, "denied", block, null, null, null),
          );
          return respondWithIdempotency(userId, idempotencyKey, envelope);
        }
      }
    }

    const effectiveCapital =
      limits.max_capital_cap > 0
        ? Math.min(settings.max_capital, limits.max_capital_cap)
        : settings.max_capital;
    // Explicit forex lot → equivalent notional (lots × contract size × price),
    // so the agent/MCP can size a trade by lot. Risk Guard still gates it.
    let notional =
      body.notional ?? (effectiveCapital * settings.per_trade_pct) / 100;
    if (body.lots && body.lots > 0 && market === "forex") {
      const spec = await getEaSymbolSpec(
        userId,
        normalizeIntentSymbol(body.symbol, market),
      );
      const price = Number(spec?.ask) || Number(spec?.bid) || body.entry || 0;
      const contractSize = Number(spec?.contract_size) || 100000;
      if (price > 0) notional = body.lots * contractSize * price;
    }

    const leverage =
      marketType === "futures"
        ? (body.leverage ?? settings.default_leverage ?? 3)
        : 1;

    const intent = await createIntent(userId, {
      recommendation_id: body.recommendation_id ?? null,
      symbol: normalizeIntentSymbol(body.symbol, market),
      side: body.side,
      notional,
      market,
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: body.take_profit ?? null,
      confidence: body.confidence,
      rationale: body.rationale ?? null,
      status: "approved",
      practice: body.practice,
      market_type: marketType,
      leverage,
      order_type: orderType,
      limit_price: body.limit_price ?? null,
    });

    const result = await executeIntent(userId, intent.id, {
      explicitApproval: body.approved_by_user,
      practiceMode: body.practice,
    });

    const confidenceEnvelope = bridgeEnvelopeForExecutionDenial(result);
    if (confidenceEnvelope) {
      await logAudit(
        userId,
        "agent_trade_open",
        `${intent.symbol} ${intent.side} denied LOW_CONFIDENCE (${body.confidence}% < threshold)`,
      );
      return respondWithIdempotency(userId, idempotencyKey, confidenceEnvelope);
    }

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
      `${intent.symbol} ${intent.side} ${notional.toFixed(2)} USDT${
        marketType === "futures"
          ? ` futures ${leverage}x${orderType === "limit" ? " limit" : ""}`
          : ""
      } → ${result.status}${result.ok ? "" : ` (${result.reason})`}`,
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
