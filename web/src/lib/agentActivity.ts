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
  get_market_snapshot: (input) => {
    const symbol = String(input.symbol ?? "الرمز");
    const interval = input.interval ? String(input.interval) : "1h";
    return `جلب لقطة فنية لـ ${symbol} · ${interval}`;
  },
  get_price: (input) => `جلب السعر اللحظي لـ ${String(input.symbol ?? "الرمز")}`,
  get_account_balances: () => "قراءة أرصدة حساب Binance",
  smart_money_signals: (input) =>
    `إشارات الأموال الذكية · سلسلة ${String(input.chainId ?? "56")}`,
  crypto_market_rank: (input) =>
    `بيانات سوق Web3 · ${String(input.command ?? "token-rank")}`,
  binance_cli: (input) => {
    const args = Array.isArray(input.args) ? input.args.map(String).join(" ") : "";
    return `Binance CLI · ${args.slice(0, 80)}`;
  },
  record_recommendation: (input) => {
    const symbol = String(input.symbol ?? "");
    const action =
      input.action === "buy" ? "شراء" : input.action === "sell" ? "بيع" : "انتظار";
    return `تسجيل توصية ${action}${symbol ? ` · ${symbol}` : ""} + لقطة شارت`;
  },
};

export function describeToolUse(
  name: string,
  input: Record<string, unknown>,
): string {
  const fn = TOOL_LABELS[name];
  return fn ? fn(input) : `تشغيل ${name}`;
}

/** يظهر سجل النشاط فقط لأسئلة تحليل/تداول وليس للمحادثة العادية */
export function needsAgentActivity(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (/\b[A-Z]{2,12}USDT\b/i.test(text)) return true;

  const lower = text.toLowerCase();
  const keywords = [
    "تحليل",
    "حلل",
    "حلّل",
    "رأيك",
    "رأي",
    "توصية",
    "توصي",
    "شراء",
    "بيع",
    "صفقة",
    "سوق",
    "فرصة",
    "مخاطر",
    "rsi",
    "macd",
    "شارت",
    "دعم",
    "مقاومة",
    "btc",
    "eth",
    "bnb",
    "sol",
    "analyze",
    "analysis",
    "trade",
    "market",
    "recommend",
    "buy",
    "sell",
    "chart",
    "price",
    "سعر",
    "عملة",
    "عملات",
    "تداول",
    "مراقب",
    "monitor",
  ];
  return keywords.some((k) => lower.includes(k));
}

export function emitActivity(
  listener: ActivityListener | undefined,
  activity: AgentActivity,
) {
  listener?.(activity);
}
