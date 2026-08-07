/**
 * Canonical MCP card translations (Arabic + English). English defines the key
 * set; Arabic must cover every key (enforced by a test). Symbols, numeric
 * prices, and technical abbreviations (RSI/MACD/TP1/SL/MT5) are never
 * translated and therefore have no keys here.
 */
import type { McpLocale } from "./mcpLocale.js";
import { DEFAULT_MCP_LOCALE } from "./mcpLocale.js";

export const MCP_EN = {
  // Common
  noData: "No data available",
  lastUpdated: "Last updated",
  status: "Status",

  // Direction / verdict
  buy: "Buy",
  sell: "Sell",
  wait: "Wait",

  // Recommendation lifecycle statuses
  "status.pending": "Pending",
  "status.pending_entry": "Pending entry",
  "status.triggered": "Entered",
  "status.tp1_hit": "TP1 reached",
  "status.tp2_hit": "TP2 reached",
  "status.tp3_hit": "TP3 reached",
  "status.sl_hit": "Stop loss hit",
  "status.expired": "Expired",
  "status.cancelled": "Cancelled",
  "status.invalidated": "Invalidated",

  // Trend
  "trend.uptrend": "Uptrend",
  "trend.downtrend": "Downtrend",
  "trend.range": "Range",
  "trend.sideways": "Sideways",
  "trend.neutral": "Neutral",
  "trend.unknown": "Unknown",

  // Account
  balance: "Balance",
  equity: "Equity",
  margin: "Margin",
  freeMargin: "Free Margin",
  floatingPnl: "Floating P/L",
  accountMode: "Account mode",
  connection: "Connection",
  openPositions: "Open positions",

  // Positions
  symbol: "Symbol",
  side: "Side",
  volume: "Volume",
  currentPrice: "Current price",
  openTime: "Open time",

  // Analysis / recommendation
  price: "Price",
  trend: "Trend",
  support: "Support",
  resistance: "Resistance",
  marketStructure: "Market structure",
  direction: "Direction",
  entry: "Entry",
  stopLoss: "Stop Loss",
  target: "Target",
  confidence: "Confidence",
  riskReward: "Risk/Reward",
  setupType: "Setup",
  keyReasons: "Key reasons",
  riskWarnings: "Risk warnings",
  timeframe: "Timeframe",

  // Risk
  riskStatus: "Risk status",
  dailyLimit: "Daily limit",
  usedRisk: "Used risk",
  remainingRisk: "Remaining risk",
  executionPermission: "Execution",
  newsRisk: "News risk",
} as const;

export type McpTranslationKey = keyof typeof MCP_EN;

export const MCP_AR: Record<McpTranslationKey, string> = {
  noData: "لا توجد بيانات متاحة",
  lastUpdated: "آخر تحديث",
  status: "الحالة",

  buy: "شراء",
  sell: "بيع",
  wait: "انتظار",

  "status.pending": "معلقة",
  "status.pending_entry": "بانتظار الدخول",
  "status.triggered": "تم الدخول",
  "status.tp1_hit": "تحقق الهدف الأول",
  "status.tp2_hit": "تحقق الهدف الثاني",
  "status.tp3_hit": "تحقق الهدف الثالث",
  "status.sl_hit": "ضُرب وقف الخسارة",
  "status.expired": "منتهية",
  "status.cancelled": "ملغاة",
  "status.invalidated": "مبطلة",

  "trend.uptrend": "اتجاه صاعد",
  "trend.downtrend": "اتجاه هابط",
  "trend.range": "نطاق عرضي",
  "trend.sideways": "حركة جانبية",
  "trend.neutral": "محايد",
  "trend.unknown": "غير معروف",

  balance: "الرصيد",
  equity: "الإيكويتي",
  margin: "الهامش",
  freeMargin: "الهامش المتاح",
  floatingPnl: "الربح/الخسارة العائمة",
  accountMode: "نوع الحساب",
  connection: "الاتصال",
  openPositions: "الصفقات المفتوحة",

  symbol: "الرمز",
  side: "الاتجاه",
  volume: "الحجم",
  currentPrice: "السعر الحالي",
  openTime: "وقت الفتح",

  price: "السعر",
  trend: "الاتجاه",
  support: "الدعم",
  resistance: "المقاومة",
  marketStructure: "هيكل السوق",
  direction: "الاتجاه",
  entry: "الدخول",
  stopLoss: "وقف الخسارة",
  target: "الهدف",
  confidence: "نسبة الثقة",
  riskReward: "نسبة العائد إلى المخاطرة",
  setupType: "نوع الصفقة",
  keyReasons: "الأسباب الرئيسية",
  riskWarnings: "تحذيرات المخاطر",
  timeframe: "الفريم",

  riskStatus: "حالة المخاطر",
  dailyLimit: "الحد اليومي",
  usedRisk: "المخاطرة المستخدمة",
  remainingRisk: "المخاطرة المتبقية",
  executionPermission: "التنفيذ",
  newsRisk: "خطر الأخبار",
};

const DICTS: Record<McpLocale, Record<string, string>> = { ar: MCP_AR, en: MCP_EN };

/** Translate a key in a locale, falling back to the default locale then the key. */
export function mcpT(locale: McpLocale, key: McpTranslationKey | string): string {
  return DICTS[locale]?.[key] ?? DICTS[DEFAULT_MCP_LOCALE][key] ?? String(key);
}

/** Localize a recommendation status value ("triggered" → localized text). */
export function mcpStatusLabel(locale: McpLocale, status: string): string {
  return mcpT(locale, `status.${status}`);
}

/** Localize a trend value ("uptrend" → localized text). */
export function mcpTrendLabel(locale: McpLocale, trend: string): string {
  return mcpT(locale, `trend.${String(trend).toLowerCase()}`);
}
