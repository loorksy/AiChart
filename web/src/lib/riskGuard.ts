import { isOpenAssetsPolicy, parseAllowedAssets } from "./allowedAssets";
import type { AdminLimits, TradingSettings } from "./types";

export interface ProposedTrade {
  symbol: string;
  side: "buy" | "sell";
  notional: number; // quote-currency amount (e.g. USDT)
}

export interface RiskContext {
  masterKill: boolean;
  openTradesCount: number;
  todayRealizedPnlPct: number; // negative = net loss today
  /** User explicitly approved a trade (e.g. Telegram approve button). */
  explicitApproval?: boolean;
}

export interface RiskDecision {
  ok: boolean;
  reason: string;
  effectiveCapital: number;
  perTradeMax: number;
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
  const maxOpen = Math.min(settings.max_open_trades, limits.max_open_trades_cap);

  const deny = (reason: string): RiskDecision => ({
    ok: false,
    reason,
    effectiveCapital,
    perTradeMax,
  });

  if (ctx.masterKill)
    return deny("التداول موقوف على مستوى المنصة (إيقاف طارئ من الإدارة).");
  if (settings.kill_switch === 1)
    return deny("الإيقاف الطارئ مفعّل في حسابك.");
  if (limits.can_execute !== 1)
    return deny("التنفيذ التلقائي غير مصرّح به من الإدارة.");
  if (settings.mode !== "auto" && !ctx.explicitApproval)
    return deny("وضعك الحالي توصيات فقط، لا تنفيذ.");

  if (!isOpenAssetsPolicy(settings.allowed_assets)) {
    const allowed = parseAllowedAssets(settings.allowed_assets);
    if (
      allowed.length > 0 &&
      !allowed.includes(proposed.symbol.toUpperCase())
    ) {
      return deny(`الأصل ${proposed.symbol} غير ضمن قائمتك المسموح بها.`);
    }
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
    settings.daily_profit_target_pct > 0 &&
    ctx.todayRealizedPnlPct >= settings.daily_profit_target_pct
  )
    return deny(
      `بلغت هدف الربح اليومي (+${settings.daily_profit_target_pct}%). لا صفقات جديدة اليوم.`,
    );

  return { ok: true, reason: "مسموح", effectiveCapital, perTradeMax };
}
