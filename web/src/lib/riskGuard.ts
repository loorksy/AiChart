import { isSymbolAllowed } from "./allowedAssets";
import { BridgeErrorCode } from "./bridge/errors";
import { resolveMaxOpenTrades } from "./riskLimits";
import type { ExecutionEnv } from "./executionEnv";
import type { MarketType } from "./markets/types";
import type { AdminLimits, TradingSettings } from "./types";

export const DEFAULT_MIN_CONFIDENCE = 80;
export const PRACTICE_MIN_CONFIDENCE_FLOOR = 50;
/**
 * Default minimum reward:risk ratio. An objective trade-quality gate — a real
 * desk does not enter a setup that risks more than it can make. This is NOT a
 * confidence cutoff; it only triggers when entry/SL/TP are all known.
 */
export const DEFAULT_MIN_RR = 1;

/** Effective minimum R:R: user override (settings.min_rr) or DEFAULT_MIN_RR. */
export function getEffectiveMinRr(settings: TradingSettings): number {
  const v = Number(settings.min_rr);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MIN_RR;
}

/**
 * Reward:risk from entry/SL/TP. Returns null when it cannot be computed
 * (missing prices or a zero-width stop) so the caller can skip the gate.
 */
export function computeRewardRisk(
  entry: number | null | undefined,
  stopLoss: number | null | undefined,
  takeProfit: number | null | undefined,
): number | null {
  if (entry == null || stopLoss == null || takeProfit == null) return null;
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (!(risk > 0) || !(reward >= 0)) return null;
  return reward / risk;
}

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
  /** Intended entry price — used with stopLoss/takeProfit for the R:R gate. */
  entry?: number | null;
  /** Stop-loss price — mandatory for every trade (liquidation/loss control). */
  stopLoss?: number | null;
  /** Take-profit price — used with entry/stopLoss for the R:R gate. */
  takeProfit?: number | null;
  /** Agent confidence 0–100 — recorded for sizing/audit, NOT a gate. */
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

  // Master per-user toggle. When OFF (0) the platform runs "full autonomous":
  // the agent + committee are the sole authority, so riskGuard SKIPS the
  // risk/permission gates below. It STILL keeps the non-negotiable execution
  // safety that would otherwise break the order or liquidate the account:
  // the platform emergency kill, the user's own kill switch, env-preference
  // sanity, all futures liquidation gates (mandatory SL, leverage cap), and
  // "can't risk more than you have". Tolerant of 0/1 (sqlite) and any future
  // boolean representation — only an explicit 0/false disables it.
  const riskEnforced =
    settings.risk_guard_enabled !== 0 &&
    (settings.risk_guard_enabled as unknown) !== false;

  // ── Always enforced (emergency + execution validity) ──────────────────────
  if (ctx.masterKill)
    return deny("التداول موقوف على مستوى المنصة (إيقاف طارئ من الإدارة).");
  if (settings.kill_switch === 1)
    return deny("الإيقاف الطارئ مفعّل في حسابك.");
  // Tolerant of SQLite (0/1) and Postgres (boolean) representations.
  if (riskEnforced && !limits.can_execute)
    return deny("التنفيذ التلقائي غير مصرّح به من الإدارة.");
  const relaxed =
    ctx.practiceMode === true || ctx.resolvedEnv === "demo";

  const minConfidence = getEffectiveMinConfidence(settings, ctx);
  if (riskEnforced && proposed.confidence < minConfidence) {
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

  if (
    riskEnforced &&
    settings.mode !== "auto" &&
    !ctx.explicitApproval &&
    !ctx.practiceMode
  )
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
  if (
    riskEnforced &&
    !isSymbolAllowed(settings.allowed_assets, proposed.symbol, market)
  ) {
    return deny(`الأصل ${proposed.symbol} غير ضمن قائمتك المسموح بها.`);
  }

  // ── Objective trade-quality gates (discipline, NOT a confidence cutoff) ────
  // A professional desk never enters without a defined stop, and never takes a
  // setup whose target is closer than its stop. These check trade QUALITY, not
  // a magic confidence number. Skipped only in full-autonomous mode.
  if (riskEnforced && proposed.stopLoss == null)
    return deny(
      "وقف الخسارة إلزامي لكل صفقة — حدّد وقفاً واضحاً قبل الدخول (انضباط مخاطر، ليس عتبة ثقة).",
    );

  const minRr = getEffectiveMinRr(settings);
  if (riskEnforced && minRr > 0) {
    const rr = computeRewardRisk(
      proposed.entry,
      proposed.stopLoss,
      proposed.takeProfit,
    );
    if (rr != null && rr < minRr)
      return deny(
        `العائد/المخاطرة (${rr.toFixed(2)}) أقل من الحد الأدنى (${minRr}) — لا ننفّذ صفقة مكافأتها أقل من خطرها.`,
      );
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
  // ── Risk gates below: skipped entirely in full-autonomous mode ────────────
  if (riskEnforced && proposed.notional > perTradeMax + 1e-8)
    return deny(
      `حجم الصفقة يتجاوز الحد الأقصى للصفقة الواحدة (${perTradeMax.toFixed(2)}).`,
    );

  if (riskEnforced && ctx.openTradesCount >= maxOpen)
    return deny(`بلغت الحد الأقصى للصفقات المفتوحة (${maxOpen}).`);

  if (
    riskEnforced &&
    settings.daily_loss_limit_pct > 0 &&
    ctx.todayRealizedPnlPct <= -settings.daily_loss_limit_pct
  )
    return deny(
      `بلغت حد الخسارة اليومي (−${settings.daily_loss_limit_pct}%). توقّف لليوم.`,
    );

  if (
    riskEnforced &&
    settings.monthly_loss_limit_pct > 0 &&
    ctx.monthRealizedPnlPct <= -settings.monthly_loss_limit_pct
  )
    return deny(
      `بلغت حد الخسارة الشهري (−${settings.monthly_loss_limit_pct}%).`,
    );

  if (riskEnforced && !relaxed) {
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
