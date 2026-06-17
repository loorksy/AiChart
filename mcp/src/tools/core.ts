import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { formatBridgeError } from "../bridge/client.js";
import { bridgeCall, bridgeWrap } from "./helpers.js";
import {
  DESTRUCTIVE,
  IDEMPOTENT_WRITE,
  MCP_SERVER_VERSION,
  READ_ONLY,
  withAnnotations,
} from "./registry.js";
import {
  chartInlineContent,
  chartTimeoutContent,
  mt5ChartPollId,
  pollBridgeMt5ChartPng,
} from "./chartInline.js";

export function registerCoreTools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "get_account_overview",
    {
      description:
        "ملخص موحّد للحساب قبل أي تداول: رصيد، رافعة، demo/live، PnL اليوم، حدود، perTradeMaxUsd، صفقات مفتوحة، quotes. استدعِه في بداية جلسة التداول.",
      inputSchema: {},
    },
    async () =>
      bridgeCall(async () => {
        const [risk, portfolio, live] = await Promise.all([
          bridge.get("/api/agent/risk/status"),
          bridge.get("/api/agent/portfolio"),
          bridge.get("/api/agent/live/account"),
        ]);
        return { risk, portfolio, live };
      }),
  );

  server.registerTool(
    "get_risk_status",
    {
      description:
        "حالة المخاطر والوضع (auto/approval/direct)، kill switch، حدود رأس المال، executionEnv، activeMarket. يعيد envelope { ok, data } على المسارات المحدّثة.",
      inputSchema: {},
      ...withAnnotations(READ_ONLY),
    },
    bridgeWrap(bridge, () => bridge.get("/api/agent/risk/status")),
  );

  server.registerTool(
    "get_trade_readiness",
    {
      description:
        "فحص جاهزية التداول قبل open_trade. متى: قبل أي صفقة فوركس أو عند quoteAgeMs>5000. لا تستخدم بديلاً عن get_risk_status. confidence اختياري للتحقق من بوابة ≥80%. لا تنفّذ open_trade إذا ready=false. مثال: symbol=EURUSD&confidence=85&market=forex.",
      inputSchema: {
        symbol: z
          .string()
          .optional()
          .describe("رمز الزوج — مطلوب لفحص quote/spread في الفوركس"),
        market: z.enum(["crypto", "forex"]).optional(),
        confidence: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("ثقة الصفقة المقترحة — يُقارَن بـ min_confidence"),
        practice: z.boolean().optional(),
      },
      ...withAnnotations(READ_ONLY),
    },
    async ({ symbol, market, confidence, practice }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/trade/readiness", {
          symbol,
          market,
          confidence,
          practice: practice ? "true" : undefined,
        }),
      ),
  );

  server.registerTool(
    "get_agent_capabilities",
    {
      description:
        "قدرات المنصة: نموذج AI، fallbacks، forex backend، serverVersion، featureFlags، EA debounce (3-strike). استدعِه عند بداية الجلسة.",
      inputSchema: {},
      ...withAnnotations(READ_ONLY),
    },
    async () => {
      try {
        const model = await bridge.get("/api/agent/model");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ...(typeof model === "object" && model !== null ? model : {}),
                  mcpServerVersion: MCP_SERVER_VERSION,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return formatBridgeError(e);
      }
    },
  );

  server.registerTool(
    "get_portfolio",
    {
      description: "محفظة المشغّل: رصيد، PnL، ملخص.",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.get("/api/agent/portfolio")),
  );

  server.registerTool(
    "get_open_trades",
    {
      description: "الصفقات المفتوحة + summary_ar.",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.get("/api/agent/trades/open")),
  );

  server.registerTool(
    "get_trade_lessons",
    {
      description:
        "دروس من صفقات سابقة — استخدم قبل التحليل. recent=true للأخطاء الأخيرة (تعويض خسارة).",
      inputSchema: {
        symbol: z.string().optional(),
        pattern: z.string().optional(),
        limit: z.number().int().min(1).max(10).optional(),
        recent: z
          .boolean()
          .optional()
          .describe("true = آخر الدروس بغض النظر عن الرمز"),
      },
    },
    async ({ symbol, pattern, limit, recent }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/memory/lessons", {
          symbol,
          pattern,
          limit,
          ...(recent ? { recent: "1" } : {}),
        }),
      ),
  );

  server.registerTool(
    "create_recommendation",
    {
      description:
        "تسجيل توصية قبل التنفيذ. rationale = 2–4 جمل عربية بصيغة «نحن» (لماذا ندخل/لا ندخل). confidence إلزامي.",
      inputSchema: {
        symbol: z.string(),
        action: z.enum(["buy", "sell", "wait"]),
        confidence: z.number().min(0).max(100),
        rationale: z.string().min(10),
        factors: z.array(z.string()).min(1).max(8),
        entry: z.number().optional(),
        stop_loss: z.number().optional(),
        take_profit: z.number().optional(),
        timeframe: z.string().optional(),
        pattern_name: z.string().optional(),
        chart_drawings: z.array(z.record(z.string(), z.unknown())).optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/recommendation", body)),
  );

  server.registerTool(
    "open_trade",
    {
      description:
        "فتح صفقة عبر Risk Guard. notional و rationale مطلوبان — اسأل «بكم ندخل؟». approved_by_user:true بعد موافقة صريحة. يرفض confidence<80 (LOW_CONFIDENCE) و quote قديم (STALE_QUOTE). idempotencyKey اختياري.",
      inputSchema: {
        symbol: z.string(),
        side: z.enum(["buy", "sell"]),
        notional: z.number().positive(),
        market: z.enum(["crypto", "forex"]).optional(),
        entry: z.number().optional(),
        stop_loss: z.number().optional(),
        take_profit: z.number().optional(),
        confidence: z.number().min(0).max(100),
        rationale: z.string().min(10),
        recommendation_id: z.number().optional(),
        approved_by_user: z.boolean().optional(),
        practice: z.boolean().optional(),
        market_type: z.enum(["spot", "futures"]).optional(),
        leverage: z.number().min(1).max(125).optional(),
        order_type: z.enum(["market", "limit"]).optional(),
        limit_price: z.number().positive().optional(),
        idempotencyKey: z
          .string()
          .max(128)
          .optional()
          .describe("مفتاح idempotency اختياري — يعيد نفس النتيجة خلال 24h"),
      },
      ...withAnnotations(IDEMPOTENT_WRITE),
    },
    async (body) => bridgeCall(() => bridge.post("/api/agent/trade/open", body)),
  );

  server.registerTool(
    "close_trade",
    {
      description: "إغلاق صفقة واحدة أو كل الصفقات.",
      inputSchema: {
        trade_id: z.number().int().positive().optional(),
        all: z.boolean().optional(),
      },
      ...withAnnotations(DESTRUCTIVE),
    },
    async (body) => bridgeCall(() => bridge.post("/api/agent/trade/close", body)),
  );

  server.registerTool(
    "evaluate_trade",
    {
      description: "تقييم صفقة مفتوحة: سعر حي، شموع، PnL، سياق.",
      inputSchema: {
        trade_id: z.number().int().positive(),
      },
    },
    async ({ trade_id }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/trade/evaluate", { trade_id }),
      ),
  );

  server.registerTool(
    "record_exit_decision",
    {
      description: "تسجيل قرار hold/close/adjust_sl (audit).",
      inputSchema: {
        trade_id: z.number().int().positive(),
        decision: z.enum(["hold", "close", "adjust_sl"]),
        reason: z.string().min(3).max(500),
        new_stop_loss: z.number().positive().optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/trade/exit-decision", body)),
  );

  server.registerTool(
    "request_approval",
    {
      description: "طلب موافقة على صفقة (أزرار تيليجرام إن وُجد ربط).",
      inputSchema: {
        symbol: z.string(),
        side: z.enum(["buy", "sell"]),
        notional: z.number().positive().optional(),
        market: z.enum(["crypto", "forex"]).optional(),
        entry: z.number().optional(),
        stop_loss: z.number().optional(),
        take_profit: z.number().optional(),
        confidence: z.number().min(0).max(100).optional(),
        rationale: z.string().optional(),
        recommendation_id: z.number().optional(),
        practice: z.boolean().optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/approval/request", body)),
  );

  server.registerTool(
    "respond_approval",
    {
      description: "الموافقة أو الرفض على intent معلّق.",
      inputSchema: {
        intent_id: z.number().int().positive(),
        action: z.enum(["approve", "reject"]),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/approval/respond", body)),
  );

  server.registerTool(
    "get_pending_approvals",
    {
      description: "قائمة طلبات الموافقة المعلّقة (pending intents).",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.get("/api/agent/approval/pending")),
  );

  server.registerTool(
    "get_execution_env",
    {
      description: "بيئة التنفيذ demo/live وBinance/MT5.",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.get("/api/agent/execution/env")),
  );

  server.registerTool(
    "set_execution_env",
    {
      description: "تبديل demo ↔ live.",
      inputSchema: {
        preference: z.enum(["demo", "live"]),
      },
    },
    async ({ preference }) =>
      bridgeCall(() =>
        bridge.post("/api/agent/execution/env", { preference }),
      ),
  );

  server.registerTool(
    "set_trading_mode",
    {
      description: "تبديل وضع التداول: auto | approval | direct.",
      inputSchema: {
        mode: z.enum(["auto", "approval", "direct"]),
      },
    },
    async ({ mode }) =>
      bridgeCall(() => bridge.post("/api/agent/mode", { mode })),
  );

  server.registerTool(
    "get_agent_settings",
    {
      description: "إعدادات الوكيل: active_market، futures_enabled، default_leverage.",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.get("/api/agent/settings")),
  );

  server.registerTool(
    "set_active_market",
    {
      description: "تبديل السوق النشط: crypto أو forex.",
      inputSchema: {
        active_market: z.enum(["crypto", "forex"]),
      },
    },
    async ({ active_market }) =>
      bridgeCall(() =>
        bridge.patch("/api/agent/settings", { active_market }),
      ),
  );

  server.registerTool(
    "set_futures_enabled",
    {
      description: "تفعيل/تعطيل تداول Binance Futures USDT-M.",
      inputSchema: {
        futures_enabled: z.boolean(),
        default_leverage: z.number().min(1).max(125).optional(),
      },
    },
    async ({ futures_enabled, default_leverage }) =>
      bridgeCall(() =>
        bridge.patch("/api/agent/settings", {
          futures_enabled,
          ...(default_leverage != null ? { default_leverage } : {}),
        }),
      ),
  );

  server.registerTool(
    "set_kill_switch",
    {
      description:
        "إيقاف طارئ: scope user|master، on/off، close_open_trades لإغلاق الصفقات فوراً.",
      inputSchema: {
        on: z.boolean(),
        scope: z.enum(["user", "master"]).optional(),
        close_open_trades: z.boolean().optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/kill-switch", body)),
  );

  server.registerTool(
    "run_trade_maintenance",
    {
      description: "صيانة ميكانيكية: OCO sync + auto take-profit (cron substitute).",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.post("/api/agent/maintenance")),
  );

  server.registerTool(
    "send_telegram_menu",
    {
      description: "إرسال بطاقة ترحيب + لوحة أزرار عربية لتيليجرام المرتبط.",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.post("/api/agent/telegram/menu")),
  );

  server.registerTool(
    "capture_chart_snapshot",
    {
      description:
        "شارت PNG مع رسوم (crypto أو forex). يرجع image inline (base64) — MT5 pending يُستطلَع تلقائياً.",
      inputSchema: {
        symbol: z.string(),
        interval: z.string().optional(),
        market: z.enum(["crypto", "forex"]).optional(),
        pattern_name: z.string().optional(),
        chart_drawings: z.array(z.record(z.string(), z.unknown())).optional(),
      },
    },
    async (body) => {
      try {
        const res = (await bridge.post("/api/agent/chart/snapshot", {
          ...body,
          response_format: "json",
        })) as {
          ok?: boolean;
          status?: string;
          chart_url?: string;
          image_base64?: string;
          mt5_symbol?: string;
        };

        if (res.status === "pending" && res.chart_url) {
          const chartId = mt5ChartPollId(res.chart_url);
          if (chartId) {
            const polled = await pollBridgeMt5ChartPng(bridge, chartId);
            if ("timeout" in polled) {
              return chartTimeoutContent(
                { chartUrl: res.chart_url, mt5Symbol: res.mt5_symbol },
                polled.retryAfterMs,
              );
            }
            return chartInlineContent(
              {
                ok: true,
                status: "ready",
                chartUrl: res.chart_url,
                mt5Symbol: res.mt5_symbol,
              },
              polled.base64,
            );
          }
        }

        if (res.image_base64) {
          return chartInlineContent(
            {
              ok: true,
              status: "ready",
              content_type: "image/png",
            },
            res.image_base64,
          );
        }

        return {
          content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
        };
      } catch (e) {
        return formatBridgeError(e);
      }
    },
  );

  server.registerTool(
    "get_recommendation_chart",
    {
      description: "شارت PNG لتوصية مسجّلة (recommendation_id).",
      inputSchema: {
        recommendation_id: z.number().int().positive(),
      },
    },
    async ({ recommendation_id }) =>
      bridgeCall(() =>
        bridge.get(`/api/agent/chart/${recommendation_id}`, {
          format: "json",
        }),
      ),
  );
}
