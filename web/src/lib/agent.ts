import {
  callAnthropic,
  callAnthropicStream,
  type ContentBlock,
  type Message,
  type ToolDef,
} from "./anthropic";
import { buildSystemPrompt, chartAnalyzeSystemSuffix } from "./persona";
import { buildUserContext, displayNameFromEmail } from "./userContext";
import {
  getUnifiedSnapshot,
  getUnifiedPrice,
  resolveSymbol,
} from "./markets";
import { getBinanceCredentials, saveRecommendation, getPublicUser, listTrades, listIntents, listRecommendations, countOpenTrades, getBinanceAccountMeta, getSettings } from "./store";
import { attachChartToRecommendation } from "./recommendationChart";
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
}

interface AgentContext {
  userId: number;
  settings: TradingSettings;
  /** Suppress advisory Telegram notify; tradeFlow sends approval cards instead. */
  telegramSession?: boolean;
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
  recorded: Recommendation[],
  signalDeliveries: DeliveryResult[],
): Promise<{ content: string; isError?: boolean }> {
  try {
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
        const rec = await saveRecommendation(ctx.userId, {
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
  const system =
    options?.mode === "chart_analyze"
      ? systemBase + chartAnalyzeSystemSuffix()
      : systemBase;
  const activeTools =
    options?.mode === "chart_analyze" ? CHART_ANALYZE_TOOLS : TOOLS;
  const maxSteps = options?.mode === "chart_analyze" ? 2 : 6;
  const messages: Message[] = [...history];
  const recorded: Recommendation[] = [];
  const signalDeliveries: DeliveryResult[] = [];
  let usageTokens = 0;
  let finalText = "";

  push({
    id: "plan",
    label: "قراءة السياق والتخطيط للخطوة التالية",
    status: "running",
  });

  const MAX_STEPS = maxSteps;
  for (let step = 0; step < MAX_STEPS; step++) {
    push({
      id: `think-${step}`,
      label: step === 0 ? "تحليل سؤالك" : "متابعة التحليل مع Claude",
      status: "running",
    });

    const useStream = Boolean(onDelta);
    const res = useStream
      ? await callAnthropicStream(
          { system, messages, tools: activeTools },
          { onTextDelta: onDelta },
        )
      : await callAnthropic({ system, messages, tools: activeTools });
    usageTokens += res.usage.input_tokens + res.usage.output_tokens;

    push({ id: `think-${step}`, label: step === 0 ? "تحليل سؤالك" : "متابعة التحليل مع Claude", status: "done" });
    push({ id: "plan", label: "قراءة السياق والتخطيط للخطوة التالية", status: "done" });

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

  push({
    id: "reply",
    label: "صياغة الرد النهائي",
    status: "running",
  });

  if (!finalText) {
    finalText = recorded.length
      ? "سجّلت توصيتي بالأعلى."
      : "لم أتمكّن من صياغة رد. حاول مجدداً.";
  }

  push({
    id: "reply",
    label: "صياغة الرد النهائي",
    status: "done",
  });

  return {
    reply: finalText,
    recommendations: recorded,
    usageTokens,
    activities,
    signalDeliveries: signalDeliveries.length ? signalDeliveries : undefined,
  };
}
