import { z } from "zod";
import { DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY } from "../registry.js";
import type { ToolDefinition } from "./types.js";
import {
  zChartDrawings,
  zConfidence,
  zInterval,
  zMarket,
  zOptionalConfidence,
  zSide,
  zSymbol,
  zTradeId,
} from "./shapes.js";

export const CORE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "get_account_overview",
    domain: "core",
    description:
      "متى: بداية جلسة التداول قبل أي قرار. يجمع risk + portfolio + live. مرن: لو فشل الجزء الحي (live) يرجع الباقي. include_live=false لملخّص سريع بلا الحساب الحي. read-only.",
    inputSchema: {
      include_live: z
        .boolean()
        .optional()
        .describe("تضمين الحساب الحي (الأبطأ) — false لملخّص أسرع"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_risk_status",
    domain: "core",
    description:
      "متى: بداية الجلسة أو قبل تغيير الوضع. kill switch، حدود، mode، executionEnv. لا تستخدم بدل get_trade_readiness لصفقة فوركس. read-only. يعيد envelope { ok, data }.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_trade_readiness",
    domain: "core",
    description:
      "متى: قبل open_trade فوركس أو quoteAgeMs>5000. لا تنفّذ إذا ready=false. read-only. مثال: symbol=EURUSD&confidence=85&market=forex.",
    inputSchema: {
      symbol: z.string().optional().describe("رمز الزوج — لفحص quote/spread"),
      market: zMarket,
      confidence: zOptionalConfidence.describe("ثقة مقترحة — تقديرية وإرشادية للوكيل"),
      practice: z.boolean().optional(),
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_agent_capabilities",
    domain: "core",
    description:
      "متى: أول رسالة في الجلسة. serverVersion، featureFlags، EA debounce. read-only. لا side-effects.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_portfolio",
    domain: "core",
    description:
      "متى: بعد get_account_overview أو لتحديث PnL. رصيد وملخص. read-only. لا تستخدم للتنفيذ.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_open_trades",
    domain: "core",
    description:
      "متى: قبل evaluate_trade أو إغلاق. صفقات مفتوحة + summary_ar. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_trade_lessons",
    domain: "core",
    description:
      "متى: قبل كل تحليل أو بعد خسارة. recent=true للأخطاء الأخيرة. read-only. مثال: symbol=BTCUSDT&recent=true.",
    inputSchema: {
      symbol: z.string().optional(),
      pattern: z.string().optional(),
      limit: z.number().int().min(1).max(10).optional(),
      recent: z.boolean().optional().describe("آخر الدروس بغض النظر عن الرمز"),
    },
    annotations: READ_ONLY,
  },
  {
    name: "create_recommendation",
    domain: "core",
    description:
      "متى: قبل open_trade — تسجيل توصية. rationale 2–4 جمل «نحن». side-effect: يكتب توصية. مثال: action=buy&confidence=85.",
    inputSchema: {
      symbol: zSymbol,
      action: z.enum(["buy", "sell", "wait"]),
      confidence: zConfidence,
      rationale: z.string().min(10),
      factors: z.array(z.string()).min(1).max(8),
      entry: z.number().optional(),
      stop_loss: z.number().optional(),
      take_profit: z.number().optional(),
      timeframe: z.string().optional(),
      pattern_name: z.string().optional(),
      chart_drawings: zChartDrawings,
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "open_trade",
    domain: "core",
    description:
      "متى: بعد موافقة صريحة + notional. يرفض إذا كان الـ quote قديماً. يتم تقييم القرار بناءً على التحليل الفني والأساسي للوكيل. idempotencyKey اختياري. side-effect: ينفّذ عبر Risk Guard. مثال: notional=50&approved_by_user=true.",
    inputSchema: {
      symbol: zSymbol,
      side: zSide,
      notional: z.number().positive(),
      market: zMarket,
      entry: z.number().optional(),
      stop_loss: z.number().optional(),
      take_profit: z.number().optional(),
      confidence: zConfidence,
      rationale: z.string().min(10),
      recommendation_id: z.number().optional(),
      approved_by_user: z.boolean().optional(),
      practice: z.boolean().optional(),
      market_type: z.enum(["spot", "futures"]).optional(),
      leverage: z.number().min(1).max(125).optional(),
      order_type: z.enum(["market", "limit"]).optional(),
      limit_price: z.number().positive().optional(),
      idempotencyKey: z.string().max(128).optional().describe("idempotency 24h"),
    },
    annotations: IDEMPOTENT_WRITE,
  },
  {
    name: "close_trade",
    domain: "core",
    description:
      "إغلاق صفقة · أغلق المركز · خروج · close position · إنهاء الصفقة بالكامل. متى: طلب المشغّل أو بعد record_exit_decision=close. side-effect: يغلق صفقة/الكل. مثال: trade_id=123.",
    inputSchema: {
      trade_id: zTradeId.optional(),
      all: z.boolean().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "evaluate_trade",
    domain: "core",
    description:
      "متى: صفقة مفتوحة وطلب المشغّل. PnL حي + سياق. read-only. مثال: trade_id=42.",
    inputSchema: { trade_id: zTradeId },
    annotations: READ_ONLY,
  },
  {
    name: "record_exit_decision",
    domain: "core",
    description:
      "متى: بعد evaluate_trade. audit hold/close/adjust_sl. side-effect: يسجّل قراراً. لا يغلق تلقائياً.",
    inputSchema: {
      trade_id: zTradeId,
      decision: z.enum(["hold", "close", "adjust_sl"]),
      reason: z.string().min(3).max(500),
      new_stop_loss: z.number().positive().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "request_approval",
    domain: "core",
    description:
      "طلب موافقة · اعتماد صفقة · إرسال للموافقة · approval buttons. متى: mode=approval. يرسل أزرار تيليجرام. side-effect: intent معلّق. لا تستخدم في direct mode.",
    inputSchema: {
      symbol: zSymbol,
      side: zSide,
      notional: z.number().positive().optional(),
      market: zMarket,
      entry: z.number().optional(),
      stop_loss: z.number().optional(),
      take_profit: z.number().optional(),
      confidence: zOptionalConfidence,
      rationale: z.string().optional(),
      recommendation_id: z.number().optional(),
      practice: z.boolean().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "respond_approval",
    domain: "core",
    description:
      "متى: intent معلّق. approve/reject. side-effect: قد ينفّذ عند approve.",
    inputSchema: {
      intent_id: zTradeId,
      action: z.enum(["approve", "reject"]),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "get_pending_approvals",
    domain: "core",
    description: "متى: mode=approval. قائمة intents معلّقة. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "get_execution_env",
    domain: "core",
    description: "متى: قبل صفقة live. demo/live + منصات. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "set_execution_env",
    domain: "core",
    description:
      "متى: تبديل demo↔live بموافقة. side-effect: يغيّر preference. لا تستخدم تلقائياً.",
    inputSchema: { preference: z.enum(["demo", "live"]) },
    annotations: DESTRUCTIVE,
  },
  {
    name: "set_trading_mode",
    domain: "core",
    description:
      "متى: تبديل auto/approval/direct. side-effect: يغيّر mode. direct موصى به للمحادثة.",
    inputSchema: { mode: z.enum(["auto", "approval", "direct"]) },
    annotations: DESTRUCTIVE,
  },
  {
    name: "get_agent_settings",
    domain: "core",
    description:
      "متى: قبل futures أو تغيير سوق. active_market، leverage. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "set_active_market",
    domain: "core",
    description:
      "متى: التبديل crypto↔forex. side-effect: يحدّث active_market.",
    inputSchema: { active_market: z.enum(["crypto", "forex"]) },
    annotations: DESTRUCTIVE,
  },
  {
    name: "set_futures_enabled",
    domain: "core",
    description:
      "متى: تفعيل Binance Futures. side-effect: إعدادات. لا تفعّل live بدون موافقة.",
    inputSchema: {
      futures_enabled: z.boolean(),
      default_leverage: z.number().min(1).max(125).optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "set_kill_switch",
    domain: "core",
    description:
      "متى: طوارئ. side-effect: يوقف التنفيذ؛ close_open_trades يغلق الصفقات.",
    inputSchema: {
      on: z.boolean(),
      scope: z.enum(["user", "master"]).optional(),
      close_open_trades: z.boolean().optional(),
    },
    annotations: DESTRUCTIVE,
  },
  {
    name: "run_trade_maintenance",
    domain: "core",
    description:
      "متى: صيانة OCO/TP ميكانيكية. side-effect: قد يعدّل أوامر. لا بديل للتحليل.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
  },
  {
    name: "send_telegram_menu",
    domain: "core",
    description:
      "متى: outbound إشعار. side-effect: رسالة تيليجرام. لا محادثة تفاعلية.",
    inputSchema: {},
    annotations: DESTRUCTIVE,
  },
  {
    name: "capture_chart_snapshot",
    domain: "core",
    description:
      "متى: مع كل توصية. PNG inline + رسوم. read-only على السوق؛ side-effect: capture. مثال: symbol=BTCUSDT&interval=1h.",
    inputSchema: {
      symbol: zSymbol,
      interval: zInterval,
      market: zMarket,
      pattern_name: z.string().optional(),
      chart_drawings: zChartDrawings,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_recommendation_chart",
    domain: "core",
    description:
      "متى: بعد create_recommendation. شارت PNG لتوصية. توصيات قديمة بدون chart_image_url قد تفشل — للشارت الحي استخدم capture_chart_snapshot. read-only.",
    inputSchema: { recommendation_id: zTradeId },
    annotations: READ_ONLY,
  },
  {
    name: "get_trading_style",
    domain: "core",
    description:
      "أسلوب التداول الحالي + قائمة الأساليب (scalp/day/swing/position). متى: بداية الجلسة لعرض الخيارات على المستخدم. read-only.",
    inputSchema: {},
    annotations: READ_ONLY,
  },
  {
    name: "set_trading_style",
    domain: "core",
    description:
      "اختيار أسلوب التداول · scalp/day/swing/position. متى: بعد سؤال المستخدم. في scalp مرّر scalp_max_trades (سقف الصفقات). side-effect: يحدّث الإعدادات. مثال: trading_style=scalp&scalp_max_trades=5.",
    inputSchema: {
      trading_style: z.enum(["scalp", "day", "swing", "position"]),
      scalp_max_trades: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe("سقف الصفقات المتزامنة — مطلوب في scalp"),
      sync_interval: z
        .boolean()
        .optional()
        .describe("ضبط الإطار الزمني تلقائياً حسب الأسلوب"),
    },
    annotations: DESTRUCTIVE,
  },
];

export const CORE_TOOL_BY_NAME = Object.fromEntries(
  CORE_TOOL_DEFINITIONS.map((t) => [t.name, t]),
) as Record<string, ToolDefinition>;
