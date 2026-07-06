export type ActivityStatus = "pending" | "running" | "done" | "error";

export interface AgentActivity {
  id: string;
  label: string;
  detail?: string;
  status: ActivityStatus;
  tool?: string;
}

export type ActivityListener = (activity: AgentActivity) => void;

const TOOL_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  resolve_symbol: (input) =>
    `تحديد الرمز · ${String(input.query ?? "")}`,
  get_user_profile: () => "قراءة ملف المستخدم",
  get_trades_summary: () => "ملخص الصفقات",
  get_recommendations_history: () => "سجل التوصيات",
  get_market_context: (input) => {
    const symbol = String(input.symbol ?? "الرمز");
    const interval = input.interval ? String(input.interval) : "1h";
    return `سياق السوق · ${symbol} · ${interval}`;
  },
  get_market_snapshot: (input) => {
    const symbol = String(input.symbol ?? "الرمز");
    const interval = input.interval ? String(input.interval) : "1h";
    return `جلب لقطة فنية لـ ${symbol} · ${interval}`;
  },
  get_price: (input) => `جلب السعر اللحظي لـ ${String(input.symbol ?? "الرمز")}`,
  get_account_balances: () => "قراءة أرصدة الحساب",
  record_recommendation: (input) => {
    const symbol = String(input.symbol ?? "");
    const action =
      input.action === "buy" ? "شراء" : input.action === "sell" ? "بيع" : "انتظار";
    return `تسجيل توصية ${action}${symbol ? ` · ${symbol}` : ""} + لقطة شارت`;
  },
  get_account_overview: () => "نظرة شاملة على الحساب والمخاطر",
  get_risk_status: () => "فحص حالة المخاطر والحدود",
  get_open_trades: () => "قراءة الصفقات المفتوحة",
  get_account_symbols: (input) =>
    `قراءة أزواج الحساب${input.market ? ` · ${input.market}` : ""}`,
  render_cards: (input) => {
    const n = Array.isArray(input.layout) ? input.layout.length : 0;
    return `عرض ${n} بطاقة تفاعلية`;
  },
  get_cards_guide: () => "مراجعة مهارة البطاقات",
  get_multi_timeframe_snapshot: (input) =>
    `تحليل عدة أطر · ${String(input.symbol ?? "الرمز")}`,
  scan_market: () => "مسح ومقارنة الفرص",
  get_trade_readiness: (input) =>
    `فحص الجاهزية للدخول · ${String(input.symbol ?? "")}`,
  open_trade: (input) => {
    const side = input.side === "buy" ? "شراء" : "بيع";
    return `فتح صفقة ${side} · ${String(input.symbol ?? "")}`;
  },
  close_trade: (input) =>
    input.all ? "إغلاق كل الصفقات" : `إغلاق الصفقة #${String(input.trade_id ?? "")}`,
  modify_sl_tp: (input) =>
    `تعديل وقف/هدف الصفقة #${String(input.trade_id ?? "")}`,
  request_approval: (input) => {
    const side = input.side === "buy" ? "شراء" : "بيع";
    return `طلب موافقة على ${side} · ${String(input.symbol ?? "")}`;
  },
  set_trading_mode: (input) => `تبديل وضع التنفيذ · ${String(input.mode ?? "")}`,
  set_active_market: () => "تبديل السوق · فوركس",
  set_trading_style: (input) =>
    `ضبط أسلوب التداول · ${String(input.trading_style ?? "")}`,
  search_trade_memory: (input) =>
    `بحث في ذاكرة الصفقات${input.symbol ? ` · ${String(input.symbol)}` : ""}`,
  set_risk_guard: () => "ضبط حارس المخاطر",
};

export function describeToolUse(
  name: string,
  input: Record<string, unknown>,
): string {
  const fn = TOOL_LABELS[name];
  return fn ? fn(input) : `تشغيل ${name}`;
}

/** يظهر سجل نشاط الوكيل لكل طلب يمرّ عبر الوكيل (دردشة + زر تحليل). */
export function needsAgentActivity(_message: string): boolean {
  return true;
}

export function emitActivity(
  listener: ActivityListener | undefined,
  activity: AgentActivity,
) {
  listener?.(activity);
}
