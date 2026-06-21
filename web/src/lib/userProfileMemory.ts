import { getSettings, getLimits, getPublicUser } from "./store";
import { allowedAssetsLabel } from "./allowedAssets";

/**
 * Builds a traceable structured profile memory derived from user records.
 * Examples: preferred assets, preferred markets, risk preferences, trading style.
 */
export async function buildUserProfileSummary(userId: number): Promise<string> {
  const [settings, limits, user] = await Promise.all([
    getSettings(userId),
    getLimits(userId),
    getPublicUser(userId),
  ]);

  if (!settings || !user) {
    return "لا توجد تفضيلات أو سجلات شخصية محفوظة للمستخدم حالياً.";
  }

  const activeMarket = settings.active_market ?? "crypto";
  const assetsLabel = allowedAssetsLabel(settings.allowed_assets, activeMarket);
  const styleAr =
    settings.style === "conservative"
      ? "محافظ (Conservative)"
      : settings.style === "balanced"
        ? "متوازن (Balanced)"
        : "نشِط/جرِيء (Aggressive)";

  const executionModeLabel =
    settings.mode === "auto"
      ? "تنفيذ تلقائي كامل (Auto)"
      : settings.mode === "direct"
        ? "تنفيذ مباشر بأمر صريح (Direct)"
        : "موافقة يدوية مسبقة (Approval)";

  const lines = [
    `- البريد الإلكتروني وصلاحية الحساب: ${user.email} [الحالة: ${user.status}] (المصدر: جدول users)`,
    `- السوق النشط المفضل: ${activeMarket === "forex" ? "سوق العملات الأجنبية (Forex)" : "العملات الرقمية (Crypto)"} (المصدر: جدول trading_settings)`,
    `- الأصول المسموح بتداولها: ${assetsLabel} (المصدر: جدول trading_settings)`,
    `- أسلوب إدارة المخاطر: ${styleAr} (المصدر: جدول trading_settings)`,
    `- أسلوب التداول الأساسي: ${settings.trading_style ?? "day"} (المصدر: جدول trading_settings)`,
    `- وضع تنفيذ الصفقات: ${executionModeLabel} (المصدر: جدول trading_settings)`,
    `- الحد الأقصى لرأس المال التداولي: ${settings.max_capital} USDT (الحد الإداري الأقصى: ${limits.max_capital_cap || "غير محدود"}) (المصدر: جدولي trading_settings و admin_limits)`,
    `- الحد الأقصى لعدد الصفقات المفتوحة بالتزامن: ${settings.max_open_trades} صفقة (الحد الإداري الأقصى: ${limits.max_open_trades_cap || "غير محدود"}) (المصدر: جدولي trading_settings و admin_limits)`,
    `- تفعيل العقود الآجلة (Futures): ${settings.futures_enabled ? "مفعّل" : "غير مفعّل"} (المصدر: جدول trading_settings)`,
    `- الرافعة المالية الافتراضية: ${settings.default_leverage ?? 3}x (الحد الإداري الأقصى: ${limits.max_leverage_cap ?? 10}x) (المصدر: جدولي trading_settings و admin_limits)`,
    `- حدود وقف الخسارة اليومي: وقف عند خسارة ${settings.daily_loss_limit_pct}% من المحفظة (المصدر: جدول trading_settings)`,
    `- نسبة الدخول بالصفقة الواحدة: ${settings.per_trade_pct}% من رأس المال المخصص (المصدر: جدول trading_settings)`,
  ];

  return [
    "# الطبقة 3: تفضيلات ملف المستخدم المستمدة من السجلات الرسمية",
    ...lines,
  ].join("\n");
}
