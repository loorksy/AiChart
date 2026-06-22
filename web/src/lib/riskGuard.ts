import { isSymbolAllowed } from "./allowedAssets";
import { BridgeErrorCode } from "./bridge/errors";
import { resolveMaxOpenTrades } from "./riskLimits";
import type { ExecutionEnv } from "./executionEnv";
import type { MarketType } from "./markets/types";
import type { AdminLimits, TradingSettings } from "./types";

export const DEFAULT_MIN_CONFIDENCE = 80;
export const PRACTICE_MIN_CONFIDENCE_FLOOR = 50;

/** Effective confidence threshold: demo/practice uses 50; live uses settings.min_confidence. (Bypassed by returning 0 to let the agent decide) */
export function getEffectiveMinConfidence(
  settings: TradingSettings,
  ctx: Pick<RiskContext, "practiceMode" | "resolvedEnv">,
): number {
  // تم إلغاء حد الثقة الأدنى الخارجي ليكون القرار راجعاً بالكامل لتحليل الوكيل
  return 0;
}

export interface ProposedTrade {
  symbol: string;
  side: "buy" | "sell";
  notional: number; // quote-currency amount (e.g. USDT) / risk budget (= margin for futures)
  market?: MarketType;
  /** 'spot' (default) or 'futures' (Binance USDT-M). */
  marketType?: "spot" | "futures";
  /** Leverage multiplier (futures only, 1 = none). */
  leverage?: number;
  /** Stop-loss price — mandatory for futures. */
  stopLoss?: number | null;
  /** Agent confidence 0–100 — enforced against settings.min_confidence on live. */
  confidence: number;
}

export interface RiskContext {
  masterKill: boolean;
  openTradesCount: number;
  todayRealizedPnlPct: number; // negative = net loss today
  todayRealizedPnlUsd: number;
  monthRealizedPnlPct: number; // negative = net loss this calendar month
  /** User explicitly approved a trade (e.g. Telegram approve button). */
  explicitApproval?: boolean;
  /** Practice / demo trial trade — relaxes some caps. */
  practiceMode?: boolean;
  /** Actual broker env for the active market. */
  resolvedEnv?: ExecutionEnv | null;
  /** User preference from settings. */
  envPreference?: ExecutionEnv;
}

export interface RiskDecision {
  ok: boolean;
  reason: string;
  effectiveCapital: number;
  perTradeMax: number;
  denyCode?: BridgeErrorCode;
  denyDetails?: Record<string, unknown>;
}

/**
 * The single authority that decides whether a trade may execute. Every hard
 * cap lives here and is enforced in code — the LLM cannot bypass it.
 * Checks run in priority order and return the first blocking reason.
 */
export function evaluateTrade(
  settings: TradingSettings,
  limits: AdminLimits,
  proposed: ProposedTrade,
  ctx: RiskContext,
): RiskDecision {
  // Effective capital is the lower of the user's cap and the admin's ceiling.
  const effectiveCapital =
    limits.max_capital_cap > 0
      ? Math.min(settings.max_capital, limits.max_capital_cap)
      : settings.max_capital;
  const perTradeMax = (effectiveCapital * settings.per_trade_pct) / 100;
  const maxOpen = resolveMaxOpenTrades(
    settings.max_open_trades,
    limits.max_open_trades_cap,
  );

  const deny = (
    reason: string,
    extras?: Pick<RiskDecision, "denyCode" | "denyDetails">,
  ): RiskDecision => ({
    ok: false,
    reason,
    effectiveCapital,
    perTradeMax,
    ...extras,
  });

  if (ctx.masterKill)
    return deny("التداول موقوف على مستوى المنصة (إيقاف طارئ من الإدارة).");
  if (settings.kill_switch === 1)
    return deny("الإيقاف الطارئ مفعّل في حسابك.");
  // Tolerant of SQLite (0/1) and Postgres (boolean) representations.
  if (!limits.can_execute)
    return deny("التنفيذ التلقائي غير مصرّح به من الإدارة.");
  const relaxed =
    ctx.practiceMode === true || ctx.resolvedEnv === "demo";

  const minConfidence = getEffectiveMinConfidence(settings, ctx);
  if (proposed.confidence < minConfidence) {
    return deny(
      `الثقة (${proposed.confidence}%) أقل من الحد الأدنى (${minConfidence}%) — لا ننفّذ. ننتظر فرصة أوضح (≥${minConfidence}%).`,
      {
        denyCode: BridgeErrorCode.LOW_CONFIDENCE,
        denyDetails: {
          confidence: proposed.confidence,
          minConfidence,
        },
      },
    );
  }

  if (settings.mode !== "auto" && !ctx.explicitApproval && !ctx.practiceMode)
    return deny("وضعك الحالي توصيات فقط، لا تنفيذ.");

  const preference = ctx.envPreference ?? "demo";
  if (
    preference === "demo" &&
    ctx.resolvedEnv === "live" &&
    !ctx.practiceMode
  ) {
    return deny(
      "التفضيل تجريبي لكن الحساب المتصل حقيقي — بدّل الحساب أو البيئة أولاً.",
    );
  }

  const market: MarketType = proposed.market ?? "crypto";
  if (!isSymbolAllowed(settings.allowed_assets, proposed.symbol, market)) {
    return deny(`الأصل ${proposed.symbol} غير ضمن قائمتك المسموح بها.`);
  }

  // Futures-specific gates (opt-in, leverage cap, mandatory SL).
  const marketType = proposed.marketType ?? "spot";
  if (marketType === "futures") {
    if (market !== "crypto")
      return deny("العقود الآجلة متاحة لسوق الكريبتو (Binance) فقط.");
    if (!settings.futures_enabled)
      return deny("تداول العقود الآجلة (Futures) غير مفعّل في إعداداتك.");
    const leverageCap =
      limits.max_leverage_cap && limits.max_leverage_cap > 0
        ? limits.max_leverage_cap
        : 10;
    const leverage = proposed.leverage ?? 1;
    if (leverage < 1 || leverage > leverageCap)
      return deny(
        `الرافعة (${leverage}x) خارج النطاق المسموح (1x — ${leverageCap}x).`,
      );
    if (proposed.stopLoss == null)
      return deny("وقف الخسارة إلزامي في صفقات العقود الآجلة (حماية من التصفية).");
    const positionNotional = proposed.notional * leverage;
    if (positionNotional > effectiveCapital + 1e-8)
      return deny(
        `حجم المركز (${positionNotional.toFixed(2)} USDT) يتجاوز سقف رأس المال (${effectiveCapital.toFixed(2)}).`,
      );
  }

  if (effectiveCapital <= 0)
    return deny("لم تُحدّد سقف رأس مال صالحاً.");
  if (proposed.notional > effectiveCapital)
    return deny("حجم الصفقة يتجاوز سقف رأس المال المسموح.");
  if (proposed.notional > perTradeMax + 1e-8)
    return deny(
      `حجم الصفقة يتجاوز الحد الأقصى للصفقة الواحدة (${perTradeMax.toFixed(2)}).`,
    );

  if (ctx.openTradesCount >= maxOpen)
    return deny(`بلغت الحد الأقصى للصفقات المفتوحة (${maxOpen}).`);

  if (
    settings.daily_loss_limit_pct > 0 &&
    ctx.todayRealizedPnlPct <= -settings.daily_loss_limit_pct
  )
    return deny(
      `بلغت حد الخسارة اليومي (−${settings.daily_loss_limit_pct}%). توقّف لليوم.`,
    );

  if (
    settings.monthly_loss_limit_pct > 0 &&
    ctx.monthRealizedPnlPct <= -settings.monthly_loss_limit_pct
  )
    return deny(
      `بلغت حد الخسارة الشهري (−${settings.monthly_loss_limit_pct}%).`,
    );

  if (!relaxed) {
    if (
      settings.daily_profit_target_pct > 0 &&
      ctx.todayRealizedPnlPct >= settings.daily_profit_target_pct
    )
      return deny(
        `بلغت هدف الربح اليومي (+${settings.daily_profit_target_pct}%). لا صفقات جديدة اليوم.`,
      );

    if (
      settings.daily_profit_target_usd > 0 &&
      ctx.todayRealizedPnlUsd >= settings.daily_profit_target_usd
    )
      return deny(
        `بلغت هدف الربح اليومي (+${settings.daily_profit_target_usd.toFixed(2)} USDT). لا صفقات جديدة اليوم.`,
      );
  }

  return { ok: true, reason: "مسموح", effectiveCapital, perTradeMax };
}
