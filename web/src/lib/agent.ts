import {
  callAnthropic,
  type ContentBlock,
  type Message,
  type ToolDef,
} from "./anthropic";
import { buildSystemPrompt } from "./persona";
import { buildSnapshot } from "./market";
import { getPrice } from "./binance";
import { getBinanceCredentials, saveRecommendation } from "./store";
import { getAccountSummary } from "./binance";
import type { Recommendation, TradingSettings } from "./types";

const TOOLS: ToolDef[] = [
  {
    name: "get_market_snapshot",
    description:
      "يجلب لقطة فنية حيّة لرمز على Binance (السعر، تغيّر 24س، RSI، المتوسطات، MACD، الاتجاه). استخدمها قبل أي رأي فني.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "مثل BTCUSDT" },
        interval: {
          type: "string",
          description: "الإطار الزمني: 1m,5m,15m,1h,4h,1d,1w",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_price",
    description: "يجلب السعر اللحظي لرمز على Binance.",
    input_schema: {
      type: "object",
      properties: { symbol: { type: "string" } },
      required: ["symbol"],
    },
  },
  {
    name: "get_account_balances",
    description: "يجلب أرصدة حساب Binance المرتبط بالمستخدم (إن وُجد).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "record_recommendation",
    description:
      "يسجّل توصية منظّمة للمستخدم. استخدمها عند وجود رأي واضح (شراء/بيع/انتظار). ضع وقف خسارة وهدفاً منطقيين لتوصيات الشراء/البيع.",
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
        rationale: { type: "string", description: "السبب بإيجاز" },
      },
      required: ["symbol", "action", "confidence", "rationale"],
    },
  },
];

export interface AgentResult {
  reply: string;
  recommendations: Recommendation[];
  usageTokens: number;
}

interface AgentContext {
  userId: number;
  settings: TradingSettings;
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentContext,
  recorded: Recommendation[],
): Promise<{ content: string; isError?: boolean }> {
  try {
    switch (name) {
      case "get_market_snapshot": {
        const symbol = String(input.symbol ?? "");
        const interval = input.interval ? String(input.interval) : "1h";
        // Market analysis always uses real (prod) public data for accuracy.
        const snap = await buildSnapshot(symbol, interval, "prod");
        return { content: JSON.stringify(snap) };
      }
      case "get_price": {
        const symbol = String(input.symbol ?? "");
        const price = await getPrice(symbol, "prod");
        return { content: JSON.stringify({ symbol, price }) };
      }
      case "get_account_balances": {
        const creds = getBinanceCredentials(ctx.userId);
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
      case "record_recommendation": {
        const rec = saveRecommendation(ctx.userId, {
          symbol: String(input.symbol ?? ""),
          action: String(input.action ?? "wait"),
          confidence: Number(input.confidence ?? 0),
          entry: input.entry != null ? Number(input.entry) : null,
          stop_loss: input.stop_loss != null ? Number(input.stop_loss) : null,
          take_profit:
            input.take_profit != null ? Number(input.take_profit) : null,
          timeframe: input.timeframe != null ? String(input.timeframe) : null,
          rationale: input.rationale != null ? String(input.rationale) : null,
        });
        recorded.push(rec);
        return { content: JSON.stringify({ ok: true, id: rec.id }) };
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
): Promise<AgentResult> {
  const system = buildSystemPrompt(ctx.settings);
  const messages: Message[] = [...history];
  const recorded: Recommendation[] = [];
  let usageTokens = 0;
  let finalText = "";

  const MAX_STEPS = 6;
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await callAnthropic({ system, messages, tools: TOOLS });
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

    // Echo the assistant's tool_use turn, then answer with tool_result blocks.
    messages.push({ role: "assistant", content: res.content });
    const results: ContentBlock[] = [];
    for (const tu of toolUses) {
      const out = await executeTool(tu.name, tu.input, ctx, recorded);
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

  return { reply: finalText, recommendations: recorded, usageTokens };
}
