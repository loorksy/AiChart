import {
  callLLM,
  callLLMStream,
  type ContentBlock,
  type Message,
  type ToolDef,
} from "./llm";
import { buildSystemPrompt, chartAnalyzeSystemSuffix } from "./persona";
import { buildUserContext, displayNameFromEmail } from "./userContext";
import {
  getUnifiedSnapshot,
  getUnifiedPrice,
  resolveSymbol,
} from "./markets";
import { getBinanceCredentials, saveRecommendation, getPublicUser, listTrades, listIntents, listRecommendations, countOpenTrades, getBinanceAccountMeta, getSettings, updateRecommendationIntelligence } from "./store";
import { attachChartToRecommendation } from "./recommendationChart";
import { internalBridgeForUser } from "./agentBridge";
import type { DeliveryResult } from "./alerts";
import { profileForInterval } from "./analysisProfile";
import {
  fetchMarketContext,
  formatContextForPrompt,
} from "./marketContext";
import {
  validateChartDrawings,
  type ChartDrawing,
} from "./chartDrawings";
import { getAccountSummary } from "./binance";
import {
  smartMoneySignals,
  cryptoMarketRank,
  type MarketRankCommand,
} from "./binanceWeb3";
import { runBinanceCli, isBinanceCliEnabled } from "./binanceCli";
import {
  searchSimilarLessons,
  formatLessonsForPrompt,
} from "./tradeMemory";
import { evaluateCommittee } from "./committee";
import type { Recommendation, TradingSettings } from "./types";
import {
  describeToolUse,
  emitActivity,
  type ActivityListener,
  type AgentActivity,
} from "./agentActivity";

const TOOLS: ToolDef[] = [
  {
    name: "resolve_symbol",
    description:
      "يحدّد زوج USDT الصحيح على Binance Spot (مثل BTC → BTCUSDT). استخدمها عندما يذكر المستخدم رمزاً غير واضح.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "مثل BTC، ETH، SOL" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_market_snapshot",
    description:
      "يجلب لقطة فنية حية من Binance: السعر، RSI، MACD، SMA، والاتجاه. استخدمها قبل أي رأي فني.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "مثل BTCUSDT، ETHUSDT" },
        interval: {
          type: "string",
          description: "1m,5m,15m,1h,4h,1d,1w",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_price",
    description: "يجلب السعر اللحظي لزوج USDT على Binance Spot.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_user_profile",
    description:
      "يجلب ملف المستخدم: الاسم، البريد، هل Binance/Telegram مربوطان، وضع التداول.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_trades_summary",
    description: "ملخص صفقات المستخدم: العدد، المفتوحة، آخر الصفقات والنوايا المعلّقة.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_recommendations_history",
    description: "آخر توصيات الوكيل المسجّلة لهذا المستخدم.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "get_account_balances",
    description: "يجلب أرصدة حساب Binance المرتبط بالمستخدم (إن وُجد).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "smart_money_signals",
    description:
      "إشارات 'الأموال الذكية' (Smart Money) على السلسلة من Binance Web3 — صفقات شراء/بيع لمحافظ محترفة. مفيدة لقياس اتجاه كبار المتداولين. السلاسل: 56 (BSC)، CT_501 (Solana).",
    input_schema: {
      type: "object",
      properties: {
        chainId: { type: "string", enum: ["56", "CT_501"] },
        pageSize: { type: "number" },
      },
      required: ["chainId"],
    },
  },
  {
    name: "crypto_market_rank",
    description:
      "بيانات سوق ذكية من Binance Web3: الرواج الاجتماعي (social-hype)، ترتيب العملات (token-rank)، تدفّق الأموال الذكية (smart-money-inflow)، ترتيب الميمز (meme-rank)، وترتيب أرباح المتداولين (address-pnl-rank). استخدمها لقياس مزاج السوق وزخمه.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: [
            "social-hype",
            "token-rank",
            "smart-money-inflow",
            "meme-rank",
            "address-pnl-rank",
          ],
        },
        chainId: { type: "string", description: "مثل 56 (BSC) أو CT_501 (Solana)" },
      },
      required: ["command", "chainId"],
    },
  },
  ...(isBinanceCliEnabled()
    ? [
        {
          name: "binance_cli",
          description:
            "قراءة بيانات Binance الرسمية الموسّعة (سبوت/فيوتشرز/أرنينغ/محفظة) عبر binance-cli — للقراءة فقط. مرّر args كمصفوفة، مثل [\"spot\",\"exchange-info\",\"--symbol\",\"BTCUSDT\"]. لا يُستخدم لفتح أو إغلاق الصفقات إطلاقاً.",
          input_schema: {
            type: "object",
            properties: {
              args: { type: "array", items: { type: "string" } },
            },
            required: ["args"],
          },
        },
      ]
    : []),
  {
    name: "get_market_context",
    description:
      "يجلب سياق السوق: أخبار، مؤشر الخوف والطمع، وملخص مزاج — حسب الإطار الزمني. استخدمها قبل التوصيات على إطارات 1h+.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        interval: {
          type: "string",
          description: "1m,5m,15m,1h,4h,1d,1w",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "search_trade_memory",
    description:
      "يبحث في دروس صفقات مغلقة سابقة (ذاكرة post-mortem) عن أنماط/رموز مشابهة. استخدمها قبل توصية جديدة.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        pattern: { type: "string" },
        limit: { type: "number" },
      },
      required: ["symbol"],
    },
  },
  {
    name: "record_recommendation",
    description:
      "يسجّل توصية منظّمة للمستخدم. استخدمها عند وجود رأي واضح (شراء/بيع/انتظار). ضع وقف خسارة وهدفاً منطقيين لتوصيات الشراء/البيع. يجب دائماً شرح الأسباب بوضوح.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        action: { type: "string", enum: ["buy", "sell", "wait"] },
        confidence: { type: "number", description: "ثقة 0-100" },
        entry: { type: "number" },
        stop_loss: { type: "number" },
        take_profit: { type: "number" },
        timeframe: { type: "string" },
        rationale: {
          type: "string",
          description:
            "شرح واضح ومترابط للقرار: لماذا هذه التوصية الآن؟ يربط بين المؤشرات والسياق.",
        },
        factors: {
          type: "array",
          items: { type: "string" },
          description:
            "قائمة عوامل محدّدة بنيت عليها التوصية. بادئة [فني] أو [خبر] أو [مزاج]. 3 عوامل على الأقل.",
        },
        pattern_name: {
          type: "string",
          description: "اسم النمط بالعربية مثل قاع W متوقع، قمة مزدوجة",
        },
        chart_drawings: {
          type: "array",
          description:
            "مصفوفة رسوم الشارت: price_line, trend_line, forecast_path, marker, channel, zone… كل عنصر له confidence و points",
          items: { type: "object" },
        },
      },
      required: ["symbol", "action", "confidence", "rationale", "factors"],
    },
  },
  // ── Execution & control tools (parity with MCP) — routed through the
  //    internal bridge to the same /api/agent/* routes (Risk Guard enforced).
  {
    name: "get_account_overview",
    description:
      "نظرة شاملة: المخاطر + المحفظة + الحساب الحي في طلب واحد. استخدمها بداية الجلسة قبل أي قرار.",
    input_schema: {
      type: "object",
      properties: { include_live: { type: "boolean" } },
    },
  },
  {
    name: "get_risk_status",
    description:
      "حالة المخاطر: مفتاح الإيقاف، الحدود، الوضع، بيئة التنفيذ. read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_open_trades",
    description: "قائمة الصفقات المفتوحة الحالية للمستخدم. read-only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_multi_timeframe_snapshot",
    description:
      "تحليل عدة أطر زمنية لزوج واحد بنداء واحد (أسرع). مثل intervals=[1h,15m,5m].",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        intervals: { type: "array", items: { type: "string" } },
        market: { type: "string", enum: ["crypto", "forex"] },
      },
      required: ["symbol"],
    },
  },
  {
    name: "scan_market",
    description:
      "مسح ومقارنة عدة رموز لاختيار أفضل فرصة. مثل symbols=[BTCUSDT,ETHUSDT].",
    input_schema: {
      type: "object",
      properties: {
        symbols: { type: "array", items: { type: "string" } },
        interval: { type: "string" },
        market: { type: "string", enum: ["crypto", "forex"] },
      },
    },
  },
  {
    name: "get_trade_readiness",
    description:
      "فحص الجاهزية قبل فتح صفقة (خصوصاً فوركس): حداثة السعر، السبريد. لا تفتح إذا ready=false.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        market: { type: "string", enum: ["crypto", "forex"] },
        confidence: { type: "number" },
      },
    },
  },
  {
    name: "open_trade",
    description:
      "يفتح صفقة. في وضع الموافقة يُنشئ نية معلّقة (تظهر بطاقة موافقة)؛ في التلقائي أو بأمر صريح ينفّذ. يمرّ عبر Risk Guard دائماً. مرّر notional وrationale وconfidence.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        side: { type: "string", enum: ["buy", "sell"] },
        notional: { type: "number", description: "حجم الصفقة (USDT/هامش)" },
        market: { type: "string", enum: ["crypto", "forex"] },
        market_type: { type: "string", enum: ["spot", "futures"] },
        leverage: { type: "number" },
        order_type: { type: "string", enum: ["market", "limit"] },
        entry: { type: "number" },
        stop_loss: { type: "number" },
        take_profit: { type: "number" },
        confidence: { type: "number" },
        rationale: { type: "string" },
        recommendation_id: { type: "number" },
        approved_by_user: {
          type: "boolean",
          description: "true عندما يأمر المستخدم صراحةً بالتنفيذ",
        },
      },
      required: ["symbol", "side"],
    },
  },
  {
    name: "close_trade",
    description:
      "يغلق صفقة مفتوحة (trade_id) أو كل الصفقات (all=true). يبلّغ الربح/الخسارة.",
    input_schema: {
      type: "object",
      properties: {
        trade_id: { type: "number" },
        all: { type: "boolean" },
      },
    },
  },
  {
    name: "modify_sl_tp",
    description: "يعدّل وقف الخسارة/الهدف لصفقة مفتوحة.",
    input_schema: {
      type: "object",
      properties: {
        trade_id: { type: "number" },
        stop_loss: { type: "number" },
        take_profit: { type: "number" },
      },
      required: ["trade_id"],
    },
  },
  {
    name: "request_approval",
    description:
      "يرسل بطاقة موافقة للمستخدم لصفقة مقترحة (وضع الموافقة). side-effect: نية معلّقة.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        side: { type: "string", enum: ["buy", "sell"] },
        notional: { type: "number" },
        market: { type: "string", enum: ["crypto", "forex"] },
        entry: { type: "number" },
        stop_loss: { type: "number" },
        take_profit: { type: "number" },
        confidence: { type: "number" },
        rationale: { type: "string" },
      },
      required: ["symbol", "side"],
    },
  },
  {
    name: "set_trading_mode",
    description: "يبدّل وضع التنفيذ: auto / approval / direct.",
    input_schema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["auto", "approval", "direct"] } },
      required: ["mode"],
    },
  },
  {
    name: "set_active_market",
    description: "يبدّل السوق النشط: crypto / forex.",
    input_schema: {
      type: "object",
      properties: {
        active_market: { type: "string", enum: ["crypto", "forex"] },
      },
      required: ["active_market"],
    },
  },
  {
    name: "set_trading_style",
    description:
      "يضبط أسلوب التداول: scalp/day/swing/position. في scalp مرّر scalp_max_trades.",
    input_schema: {
      type: "object",
      properties: {
        trading_style: {
          type: "string",
          enum: ["scalp", "day", "swing", "position"],
        },
        scalp_max_trades: { type: "number" },
        sync_interval: { type: "boolean" },
      },
      required: ["trading_style"],
    },
  },
  {
    name: "get_scalp_status",
    description:
      "حالة جلسة السكالب + هل السكالب مسموح (scalp_enabled) ووضع التنفيذ. read-only. استدعها أولاً عند أي طلب سكالب.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "start_scalp_session",
    description:
      "يبدأ جلسة سكالب (بعد التحقق أن scalp_enabled=1). مرّر symbol وmax_trades.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string" },
        market: { type: "string", enum: ["crypto", "forex"] },
        interval: { type: "string" },
        max_trades: { type: "number" },
        notional: { type: "number" },
      },
      required: ["symbol", "max_trades"],
    },
  },
  {
    name: "stop_scalp_session",
    description: "يوقف جلسة السكالب الحالية.",
    input_schema: { type: "object", properties: {} },
  },
];

const CHART_ANALYZE_TOOL_NAMES = new Set([
  "record_recommendation",
  "get_market_context",
  "get_price",
]);

const CHART_ANALYZE_TOOLS = TOOLS.filter((t) =>
  CHART_ANALYZE_TOOL_NAMES.has(t.name),
);

export interface AgentResult {
  reply: string;
  recommendations: Recommendation[];
  usageTokens: number;
  activities: AgentActivity[];
  signalDeliveries?: DeliveryResult[];
}

export interface RunAgentOptions {
  onActivity?: ActivityListener;
  onDelta?: (text: string) => void;
  conversationSummary?: string | null;
  mode?: "default" | "chart_analyze";
  /** Response depth chosen on the chat start screen. */
  responseMode?: "fast" | "expert" | "vision";
}

interface AgentContext {
  userId: number;
  settings: TradingSettings;
  /** Suppress advisory Telegram notify; tradeFlow sends approval cards instead. */
  telegramSession?: boolean;
}

/** Tools that forward to the internal /api/agent/* bridge (parity with MCP). */
const BRIDGE_TOOL_NAMES = new Set([
  "get_account_overview",
  "get_risk_status",
  "get_open_trades",
  "get_multi_timeframe_snapshot",
  "scan_market",
  "get_trade_readiness",
  "open_trade",
  "close_trade",
  "modify_sl_tp",
  "request_approval",
  "set_trading_mode",
  "set_active_market",
  "set_trading_style",
  "get_scalp_status",
  "start_scalp_session",
  "stop_scalp_session",
]);

/** Routes a bridge tool to its /api/agent/* endpoint via the internal bridge. */
async function forwardBridge(
  userId: number,
  name: string,
  input: Record<string, unknown>,
): Promise<{ content: string; isError?: boolean }> {
  const bridge = await internalBridgeForUser(userId);
  const ok = (data: unknown) => ({ content: JSON.stringify(data) });

  switch (name) {
    case "get_account_overview": {
      const includeLive = input.include_live !== false;
      const settled = await Promise.allSettled([
        bridge.get("/api/agent/risk/status"),
        bridge.get("/api/agent/portfolio"),
        includeLive
          ? bridge.get("/api/agent/live/account")
          : Promise.resolve({ skipped: true }),
      ]);
      const val = (r: PromiseSettledResult<unknown>) =>
        r.status === "fulfilled"
          ? r.value
          : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
      return ok({
        risk: val(settled[0]),
        portfolio: val(settled[1]),
        live: includeLive ? val(settled[2]) : { skipped: true },
      });
    }
    case "get_risk_status":
      return ok(await bridge.get("/api/agent/risk/status"));
    case "get_open_trades":
      return ok(await bridge.get("/api/agent/trades/open"));
    case "get_multi_timeframe_snapshot":
      return ok(
        await bridge.get("/api/agent/market/multi-snapshot", {
          symbol: String(input.symbol ?? ""),
          intervals:
            Array.isArray(input.intervals) && input.intervals.length
              ? input.intervals.map((i) => String(i)).join(",")
              : undefined,
          market: input.market as string | undefined,
        }),
      );
    case "scan_market":
      return ok(await bridge.post("/api/agent/market/scan", input));
    case "get_trade_readiness":
      return ok(
        await bridge.get("/api/agent/trade/readiness", {
          symbol: input.symbol as string | undefined,
          market: input.market as string | undefined,
          confidence: input.confidence as number | undefined,
        }),
      );
    case "open_trade":
      return ok(await bridge.post("/api/agent/trade/open", input));
    case "close_trade":
      return ok(await bridge.post("/api/agent/trade/close", input));
    case "modify_sl_tp":
      return ok(await bridge.post("/api/agent/ea/modify-sl-tp", input));
    case "request_approval":
      return ok(await bridge.post("/api/agent/approval/request", input));
    case "set_trading_mode":
      return ok(await bridge.post("/api/agent/mode", { mode: input.mode }));
    case "set_active_market":
      return ok(
        await bridge.patch("/api/agent/settings", {
          active_market: input.active_market,
        }),
      );
    case "set_trading_style":
      return ok(await bridge.post("/api/agent/style", input));
    case "get_scalp_status":
      return ok(await bridge.get("/api/agent/scalp"));
    case "start_scalp_session":
      return ok(await bridge.post("/api/agent/scalp", { action: "start", ...input }));
    case "stop_scalp_session":
      return ok(await bridge.post("/api/agent/scalp", { action: "stop" }));
    default:
      return { content: `أداة جسر غير معروفة: ${name}`, isError: true };
  }
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
  recorded: Recommendation[],
  signalDeliveries: DeliveryResult[],
): Promise<{ content: string; isError?: boolean }> {
  try {
    if (BRIDGE_TOOL_NAMES.has(name)) {
      return await forwardBridge(ctx.userId, name, input);
    }
    switch (name) {
      case "resolve_symbol": {
        const resolved = resolveSymbol(
          String(input.query ?? ""),
          ctx.settings.active_market,
        );
        return { content: JSON.stringify(resolved) };
      }
      case "get_market_snapshot": {
        const symbol = String(input.symbol ?? "");
        const interval = input.interval ? String(input.interval) : "1h";
        const snap = await getUnifiedSnapshot(
          symbol,
          ctx.settings.active_market,
          interval,
          ctx.userId,
        );
        return { content: JSON.stringify(snap) };
      }
      case "get_price": {
        const symbol = String(input.symbol ?? "");
        const { resolved, price } = await getUnifiedPrice(
          symbol,
          ctx.settings.active_market,
          ctx.userId,
        );
        return {
          content: JSON.stringify({
            symbol: resolved.symbol,
            market: resolved.market,
            price,
          }),
        };
      }
      case "get_user_profile": {
        const user = await getPublicUser(ctx.userId);
        const settings = await getSettings(ctx.userId);
        const binance = await getBinanceAccountMeta(ctx.userId);
        if (!user) return { content: "المستخدم غير موجود.", isError: true };
        return {
          content: JSON.stringify({
            displayName: displayNameFromEmail(user.email),
            email: user.email,
            status: user.status,
            binanceLinked: Boolean(binance),
            binanceEnv: binance?.env ?? null,
            telegramLinked: Boolean(settings.telegram_chat_id),
            mode: settings.mode,
            style: settings.style,
            context: await buildUserContext(ctx.userId),
          }),
        };
      }
      case "get_trades_summary": {
        const trades = await listTrades(ctx.userId, 10);
        const intents = await listIntents(ctx.userId, "pending", 10);
        return {
          content: JSON.stringify({
            totalTrades: (await listTrades(ctx.userId, 500)).length,
            openTrades: await countOpenTrades(ctx.userId),
            pendingIntents: intents.length,
            recentTrades: trades,
            pendingIntentsList: intents,
          }),
        };
      }
      case "get_recommendations_history": {
        const limit = input.limit ? Number(input.limit) : 10;
        const recs = await listRecommendations(ctx.userId, limit);
        return { content: JSON.stringify(recs) };
      }
      case "get_account_balances": {
        const creds = await getBinanceCredentials(ctx.userId);
        if (!creds) {
          return {
            content: "لا يوجد حساب Binance مرتبط بهذا المستخدم بعد.",
          };
        }
        const summary = await getAccountSummary(
          creds.apiKey,
          creds.apiSecret,
          creds.env,
        );
        return {
          content: JSON.stringify({
            env: creds.env,
            canTrade: summary.canTrade,
            balances: summary.balances.slice(0, 20),
          }),
        };
      }
      case "smart_money_signals": {
        const data = await smartMoneySignals({
          chainId: String(input.chainId ?? "56"),
          pageSize: input.pageSize ? Number(input.pageSize) : 30,
        });
        return { content: JSON.stringify(data).slice(0, 6000) };
      }
      case "crypto_market_rank": {
        const data = await cryptoMarketRank(
          String(input.command) as MarketRankCommand,
          { ...input, command: undefined },
        );
        return { content: JSON.stringify(data).slice(0, 6000) };
      }
      case "binance_cli": {
        const args = Array.isArray(input.args)
          ? input.args.map((a) => String(a))
          : [];
        const res = await runBinanceCli(ctx.userId, args);
        return { content: res.output, isError: !res.ok };
      }
      case "get_market_context": {
        const symbol = String(input.symbol ?? "");
        const interval = input.interval ? String(input.interval) : "1h";
        const profile = profileForInterval(interval);
        const ctx = await fetchMarketContext(symbol, profile);
        return {
          content: JSON.stringify({
            profile: profile.labelAr,
            context: formatContextForPrompt(ctx),
            headlines: ctx.headlines.slice(0, 5),
            fearGreed: ctx.fearGreed ?? null,
          }),
        };
      }
      case "search_trade_memory": {
        const symbol = String(input.symbol ?? "");
        const pattern =
          input.pattern != null ? String(input.pattern) : undefined;
        const limit = input.limit ? Number(input.limit) : 3;
        const lessons = await searchSimilarLessons(ctx.userId, {
          symbol,
          pattern,
          limit,
        });
        return {
          content: JSON.stringify({
            count: lessons.length,
            lessons,
            promptBlock: formatLessonsForPrompt(lessons),
          }),
        };
      }
      case "record_recommendation": {
        const action = String(input.action ?? "wait");
        const confidence = Number(input.confidence ?? 0);
        const timeframe =
          input.timeframe != null ? String(input.timeframe) : "1h";
        const profile = profileForInterval(timeframe);
        const rawDrawings = Array.isArray(input.chart_drawings)
          ? (input.chart_drawings as ChartDrawing[])
          : [];
        const drawings = validateChartDrawings(
          rawDrawings,
          action,
          confidence,
          profile,
        );
        let rec = await saveRecommendation(ctx.userId, {
          symbol: String(input.symbol ?? ""),
          action,
          confidence,
          entry: input.entry != null ? Number(input.entry) : null,
          stop_loss: input.stop_loss != null ? Number(input.stop_loss) : null,
          take_profit:
            input.take_profit != null ? Number(input.take_profit) : null,
          timeframe,
          rationale: input.rationale != null ? String(input.rationale) : null,
          factors: Array.isArray(input.factors)
            ? input.factors.map((f) => String(f)).slice(0, 8)
            : null,
          pattern_name:
            input.pattern_name != null ? String(input.pattern_name) : null,
          chart_drawings_json:
            drawings.length > 0 ? JSON.stringify(drawings) : null,
          analysis_tier: profile.tier,
        });
        const lessons = await searchSimilarLessons(ctx.userId, {
          symbol: rec.symbol,
          pattern: rec.pattern_name ?? undefined,
          limit: 3,
        });
        if (lessons.length || action === "buy" || action === "sell") {
          const committee = await evaluateCommittee(ctx.userId, rec, lessons);
          await updateRecommendationIntelligence(rec.id, {
            committee_json: JSON.stringify(committee),
            memory_refs_json: lessons.length
              ? JSON.stringify(lessons.map((l) => l.id))
              : null,
          });
          rec = {
            ...rec,
            committee_json: JSON.stringify(committee),
            memory_refs_json: lessons.length
              ? JSON.stringify(lessons.map((l) => l.id))
              : null,
          };
        }
        const notifyAdvisory =
          (rec.action === "buy" || rec.action === "sell") &&
          ctx.settings.mode !== "auto" &&
          !ctx.telegramSession;
        const { rec: enriched, delivery } = await attachChartToRecommendation(ctx.userId, rec, {
          notify: notifyAdvisory,
          drawings,
        });
        if (delivery) signalDeliveries.push(delivery);
        recorded.push(enriched);
        return {
          content: JSON.stringify({
            ok: true,
            id: enriched.id,
            chart_image_url: enriched.chart_image_url ?? null,
          }),
        };
      }
      default:
        return { content: `أداة غير معروفة: ${name}`, isError: true };
    }
  } catch (e) {
    return {
      content: e instanceof Error ? e.message : "فشل تنفيذ الأداة.",
      isError: true,
    };
  }
}

/**
 * Runs the expert agent for one user turn: a bounded tool-use loop that lets
 * Claude fetch live market data and (optionally) record a recommendation.
 */
export async function runAgent(
  ctx: AgentContext,
  history: Message[],
  options?: RunAgentOptions,
): Promise<AgentResult> {
  const onActivity = options?.onActivity;
  const onDelta = options?.onDelta;
  const activities: AgentActivity[] = [];
  const push = (activity: AgentActivity) => {
    const idx = activities.findIndex((a) => a.id === activity.id);
    if (idx >= 0) activities[idx] = activity;
    else activities.push(activity);
    emitActivity(onActivity, activity);
  };

  const systemBase = await buildSystemPrompt(
    ctx.settings,
    ctx.userId,
    options?.conversationSummary,
  );
  const responseHint =
    options?.responseMode === "fast"
      ? "\n\n# نمط الرد: سريع\n- موجز ومباشر. قلّل استدعاء الأدوات لأقل ما يلزم للقرار. بطاقة قصيرة."
      : options?.responseMode === "vision"
        ? "\n\n# نمط الرد: رؤية\n- ركّز على الشارت: التقط لقطة (capture_chart_snapshot) وحلّل الأنماط والمستويات بصرياً قبل الحكم."
        : options?.responseMode === "expert"
          ? "\n\n# نمط الرد: خبير\n- تحليل أعمق متعدد الأطر: استخدم get_multi_timeframe_snapshot + المؤشرات + كود الاستراتيجية. وازن بين الأطر."
          : "";
  const system =
    options?.mode === "chart_analyze"
      ? {
          static: systemBase.static + chartAnalyzeSystemSuffix(),
          dynamic: systemBase.dynamic,
        }
      : { static: systemBase.static + responseHint, dynamic: systemBase.dynamic };
  const activeTools =
    options?.mode === "chart_analyze" ? CHART_ANALYZE_TOOLS : TOOLS;
  const maxSteps =
    options?.mode === "chart_analyze"
      ? 2
      : options?.responseMode === "fast"
        ? 6
        : options?.responseMode === "expert"
          ? 14
          : 10;
  const messages: Message[] = [...history];
  const recorded: Recommendation[] = [];
  const signalDeliveries: DeliveryResult[] = [];
  let usageTokens = 0;
  let finalText = "";

  // No scripted "planning/thinking" steps — activities reflect ONLY the agent's
  // real tool calls below. If the agent answers directly (no tools), nothing is
  // shown. The agent itself decides when work is needed.
  const MAX_STEPS = maxSteps;
  for (let step = 0; step < MAX_STEPS; step++) {
    const useStream = Boolean(onDelta);
    const res = useStream
      ? await callLLMStream(
          { system, messages, tools: activeTools },
          { onTextDelta: onDelta },
        )
      : await callLLM({ system, messages, tools: activeTools });
    usageTokens += res.usage.input_tokens + res.usage.output_tokens;

    const textParts = res.content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text);
    if (textParts.length) finalText = textParts.join("\n").trim();

    const toolUses = res.content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use",
    );

    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      break;
    }

    messages.push({ role: "assistant", content: res.content });
    const results: ContentBlock[] = [];
    for (const tu of toolUses) {
      const label = describeToolUse(tu.name, tu.input);
      push({
        id: tu.id,
        label,
        status: "running",
        tool: tu.name,
      });
      const out = await executeTool(tu.name, tu.input, ctx, recorded, signalDeliveries);
      push({
        id: tu.id,
        label,
        status: out.isError ? "error" : "done",
        tool: tu.name,
        detail: out.isError ? out.content.slice(0, 120) : undefined,
      });
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: out.content,
        is_error: out.isError,
      });
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) {
    finalText = recorded.length
      ? "سجّلت توصيتي بالأعلى."
      : "لم أتمكّن من صياغة رد. حاول مجدداً.";
  }

  return {
    reply: finalText,
    recommendations: recorded,
    usageTokens,
    activities,
    signalDeliveries: signalDeliveries.length ? signalDeliveries : undefined,
  };
}
