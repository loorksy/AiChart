import type { ApiRestrictions } from "./binance";

export interface BinanceAccountSummaryLike {
  canTrade: boolean;
  canWithdraw: boolean;
}

export interface BinancePermissionCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: "ok" | "warn" | "error";
  detail?: string;
}

export interface BinancePermissionReport {
  ok: boolean;
  blockReason: string | null;
  checks: BinancePermissionCheck[];
  withdrawWarning: string | null;
  ipRestrictionAdvice: string | null;
}

/**
 * Builds a human-readable permission report for a Binance API key.
 * Withdrawals are never used by the platform — enabled withdrawals = critical warn.
 */
export function buildBinancePermissionReport(
  summary: BinanceAccountSummaryLike,
  restrictions: ApiRestrictions | null,
  env: "testnet" | "prod",
  options?: { futuresRequired?: boolean },
): BinancePermissionReport {
  const futuresRequired = options?.futuresRequired ?? false;
  const checks: BinancePermissionCheck[] = [];

  checks.push({
    id: "spot_trading",
    label: "تداول Spot",
    ok: summary.canTrade,
    severity: summary.canTrade ? "ok" : "error",
    detail: summary.canTrade
      ? "مفعّل"
      : "المفتاح لا يملك صلاحية التداول — فعّلها من Binance API.",
  });

  if (env === "prod" && restrictions) {
    checks.push({
      id: "spot_margin_api",
      label: "Spot & Margin (API)",
      ok: restrictions.enableSpotAndMarginTrading,
      severity: restrictions.enableSpotAndMarginTrading ? "ok" : "warn",
      detail: restrictions.enableSpotAndMarginTrading
        ? "مفعّل"
        : "غير مؤكّد من apiRestrictions.",
    });

    checks.push({
      id: "futures",
      label: "Futures (USDT-M)",
      ok: restrictions.enableFutures,
      severity:
        futuresRequired && !restrictions.enableFutures ? "error" : "ok",
      detail: restrictions.enableFutures
        ? "مفعّل"
        : futuresRequired
          ? "مطلوب لتداول العقود الآجلة — فعّله من Binance API."
          : "غير مفعّل (Spot فقط).",
    });

    const withdrawalsEnabled =
      summary.canWithdraw || restrictions.enableWithdrawals;
    checks.push({
      id: "withdrawals",
      label: "السحب (Withdrawals)",
      ok: !withdrawalsEnabled,
      severity: withdrawalsEnabled ? "error" : "ok",
      detail: withdrawalsEnabled
        ? "مفعّل — خطر أمني! عطّله فوراً."
        : "معطّل (آمن).",
    });

    checks.push({
      id: "ip_restrict",
      label: "تقييد IP",
      ok: restrictions.ipRestrict,
      severity: restrictions.ipRestrict ? "ok" : "warn",
      detail: restrictions.ipRestrict
        ? "مفعّل"
        : "غير مقيّد — يُنصح بتقييد عناوين IP.",
    });
  } else if (env === "testnet") {
    checks.push({
      id: "futures",
      label: "Futures (testnet)",
      ok: true,
      severity: "ok",
      detail: "testnet — لا فحص apiRestrictions.",
    });
    checks.push({
      id: "withdrawals",
      label: "السحب",
      ok: !summary.canWithdraw,
      severity: summary.canWithdraw ? "warn" : "ok",
      detail: summary.canWithdraw ? "مفعّل على testnet." : "معطّل.",
    });
  }

  const withdrawalsEnabled =
    summary.canWithdraw ||
    Boolean(restrictions?.enableWithdrawals && env === "prod");

  const withdrawWarning = withdrawalsEnabled
    ? "تحذير أمني حرج: مفتاحك يملك صلاحية السحب (Withdrawals). عطّلها فوراً من إعدادات Binance API — المنصة لا تستخدم السحب أبداً ووجود الصلاحية خطر تسريب."
    : null;

  const ipRestrictionAdvice =
    env === "prod" && restrictions && !restrictions.ipRestrict
      ? "نصيحة أمنية: قيّد المفتاح بعناوين IP محددة من إعدادات Binance API."
      : null;

  let blockReason: string | null = null;
  if (!summary.canTrade) {
    blockReason =
      "المفتاح لا يملك صلاحية التداول. فعّل التداول في إعدادات Binance API.";
  } else if (
    futuresRequired &&
    env === "prod" &&
    restrictions &&
    !restrictions.enableFutures
  ) {
    blockReason =
      "مفتاح Binance لا يملك صلاحية Futures. فعّل enableFutures من إعدادات API.";
  }

  const ok = blockReason == null;

  return {
    ok,
    blockReason,
    checks,
    withdrawWarning,
    ipRestrictionAdvice,
  };
}

/** Returns block reason if futures trading is not permitted on this key (prod). */
export function futuresPermissionBlockReason(
  summary: BinanceAccountSummaryLike,
  restrictions: ApiRestrictions | null,
  env: "testnet" | "prod",
): string | null {
  return buildBinancePermissionReport(summary, restrictions, env, {
    futuresRequired: true,
  }).blockReason;
}
