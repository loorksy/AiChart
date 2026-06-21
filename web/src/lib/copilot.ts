import { execute } from "./db";
import { getConversation } from "./conversations";
import { runAgent } from "./agent";
import { getSettings, updateSettings, getLimits, countOpenTrades } from "./store";
import { callLLM } from "./llm";
import { evaluateTrade } from "./riskGuard";
import type { ContentBlock, Message } from "./llm";
import type { AgentResult, RunAgentOptions } from "./agent";
import type { Conversation } from "./types";

export type IntentCategory = 'Trade Execution' | 'Market Analysis' | 'Portfolio Review' | 'General Analysis';

/**
 * Fast JavaScript rule-based regex keyword classification.
 * Returns null if ambiguous, falling back to LLM.
 */
export function classifyIntentRuleBased(text: string): IntentCategory | null {
  const t = text.toLowerCase();
  
  // Trade Execution: explicit commands or intent to buy/sell/close
  const tradeRegex = /(شراء|بيع|صفقة|صفقات|دخول|خروج|إغلاق|تعديل|أمر|تداول|وقف الخسارة|أخذ الربح|buy|sell|trade|long|short|limit|order|close|open|sl|tp)/i;
  
  // Portfolio Review: checking balances, pnl, positions
  const portfolioRegex = /(محفظة|محفظتي|رصيد|أرصدة|صفقات مفتوحة|حالة الحساب|أرباح|خسائر|حسابي|بياناتي|بيانات الحساب|portfolio|balance|balances|pnl|open positions|account)/i;
  
  // Market Analysis: technical indicators, analysis, chart scans
  const analysisRegex = /(تحليل|شارت|سعر|أسعار|مؤشر|مؤشرات|فني|اتجاه|أخبار|فرصة|فرص|تحركات|chart|price|rsi|macd|indicator|trend|opportunity|scan|sma)/i;

  if (tradeRegex.test(t)) {
    return 'Trade Execution';
  }
  if (portfolioRegex.test(t)) {
    return 'Portfolio Review';
  }
  if (analysisRegex.test(t)) {
    return 'Market Analysis';
  }
  
  return null;
}

/**
 * Fallback intent classification using a fast, bounded LLM call.
 */
export async function classifyIntentLLM(text: string): Promise<IntentCategory> {
  try {
    const response = await callLLM({
      system: {
        static: "You are a fast intent classifier for a trading copilot. Categorize the user's message into one of these exact categories: 'Trade Execution', 'Market Analysis', 'Portfolio Review', or 'General Analysis'. Output ONLY the category name and nothing else.",
        dynamic: ""
      },
      messages: [{ role: "user", content: text }],
      maxTokens: 10
    });
    
    const reply = response.content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
      
    if (reply.includes('Trade Execution')) return 'Trade Execution';
    if (reply.includes('Market Analysis')) return 'Market Analysis';
    if (reply.includes('Portfolio Review')) return 'Portfolio Review';
    return 'General Analysis';
  } catch (err) {
    console.error("LLM classification failed, falling back to General Analysis:", err);
    return 'General Analysis';
  }
}

/**
 * Logs dynamic activities, safety outcomes and transitions to copilot_events.
 */
export async function logCopilotEvent(
  userId: number,
  conversationId: number | null,
  eventType: string,
  payload: any
) {
  try {
    await execute(
      "INSERT INTO copilot_events (user_id, conversation_id, event_type, payload_json) VALUES (?, ?, ?, ?)",
      [userId, conversationId, eventType, JSON.stringify(payload)]
    );
  } catch (err) {
    console.error("Failed to log copilot event:", err);
  }
}

/**
 * Updates conversation state and context in the database.
 */
async function updateConversationWorkflow(
  conversationId: number,
  userId: number,
  state: string | null,
  context: Record<string, any>
) {
  await execute(
    "UPDATE conversations SET workflow_state = ?, workflow_context = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [state, JSON.stringify(context), conversationId, userId]
  );
}

/**
 * Central orchestrator wrapping runAgent reasoning engine.
 */
export async function runCopilot(
  userId: number,
  conversationId: number,
  messageText: string,
  history: Message[],
  options?: RunAgentOptions
): Promise<AgentResult & { question?: any }> {
  // 1. Fetch active state and context
  const conv = await getConversation(conversationId, userId);
  let workflowState = conv?.workflow_state || null;
  let workflowContext: Record<string, any> = {};
  if (conv?.workflow_context) {
    try {
      workflowContext = JSON.parse(conv.workflow_context);
    } catch (e) {
      console.error("Failed to parse workflow_context:", e);
    }
  }

  // 2. Cancellation intercept
  const normalizedMsg = messageText.trim().toLowerCase();
  const isCancel = /(إلغاء|تراجع|توقف|cancel|stop|reset)/i.test(normalizedMsg);
  if (isCancel && workflowState) {
    await updateConversationWorkflow(conversationId, userId, null, {});
    await logCopilotEvent(userId, conversationId, "workflow_cancelled", { previous_state: workflowState });
    return {
      reply: "تم إلغاء سير العمل وتصفير الحالة بنجاح. كيف يمكنني مساعدتك الآن؟",
      recommendations: [],
      usageTokens: 0,
      activities: [],
    };
  }

  const settings = await getSettings(userId);
  let parameterMatched = false;

  // 3. State Resumption & Parameters extraction
  if (workflowState === "awaiting_timeframe_selection") {
    let timeframe: string | null = null;
    const msg = messageText.toLowerCase();
    
    if (msg.includes("15m") || msg.includes("15 دقيقة") || msg.includes("ربع ساعة")) {
      timeframe = "15m";
    } else if (msg.includes("1h") || msg.includes("ساعة واحدة") || msg.includes("ساعة")) {
      timeframe = "1h";
    } else if (msg.includes("4h") || msg.includes("4 ساعات") || msg.includes("أربع ساعات")) {
      timeframe = "4h";
    } else if (msg.includes("1d") || msg.includes("يوم") || msg.includes("يومي")) {
      timeframe = "1d";
    } else if (msg.includes("5m") || msg.includes("5 دقائق") || msg.includes("خمس دقائق")) {
      timeframe = "5m";
    } else if (msg.includes("1m") || msg.includes("دقيقة") || msg.includes("دقيقة واحدة")) {
      timeframe = "1m";
    }
    
    if (timeframe) {
      workflowContext.timeframe = timeframe;
      await updateSettings(userId, { analysis_interval: timeframe });
      parameterMatched = true;
      workflowState = null;
      await logCopilotEvent(userId, conversationId, "workflow_parameter_resolved", { parameter: "timeframe", value: timeframe });
    }
  } else if (workflowState === "awaiting_strategy_selection") {
    let strategy: string | null = null;
    const msg = messageText.toLowerCase();
    
    if (msg.includes("scalp") || msg.includes("سكالب") || msg.includes("مضاربة لحظية") || msg.includes("مضاربه")) {
      strategy = "scalp";
    } else if (msg.includes("day") || msg.includes("يومي") || msg.includes("تداول يومي")) {
      strategy = "day";
    } else if (msg.includes("swing") || msg.includes("سوينج") || msg.includes("تأرجحي")) {
      strategy = "swing";
    } else if (msg.includes("position") || msg.includes("استثماري") || msg.includes("طويل المدى")) {
      strategy = "position";
    }
    
    if (strategy) {
      workflowContext.trading_style = strategy;
      await updateSettings(userId, { trading_style: strategy });
      parameterMatched = true;
      workflowState = null;
      await logCopilotEvent(userId, conversationId, "workflow_parameter_resolved", { parameter: "trading_style", value: strategy });
    }
  }

  // If we were expecting parameter input but got invalid input, ask again
  if (workflowState && !parameterMatched) {
    let questionBlock: any = null;
    let replyText = "";
    
    if (workflowState === "awaiting_timeframe_selection") {
      replyText = "لم أفهم خيار الإطار الزمني المدخل. الرجاء اختيار أحد الخيارات أدناه:";
      questionBlock = {
        type: "timeframe",
        text: replyText,
        options: [
          { label: "15 دقيقة (15m)", value: "15m" },
          { label: "ساعة واحدة (1h)", value: "1h" },
          { label: "4 ساعات (4h)", value: "4h" },
          { label: "يومي (1d)", value: "1d" }
        ]
      };
    } else if (workflowState === "awaiting_strategy_selection") {
      replyText = "لم أفهم خيار نمط التداول المدخل. الرجاء اختيار أحد الخيارات أدناه:";
      questionBlock = {
        type: "trading_style",
        text: replyText,
        options: [
          { label: "مضاربة لحظية (Scalp)", value: "scalp" },
          { label: "تداول يومي (Day)", value: "day" },
          { label: "تأرجحي (Swing)", value: "swing" },
          { label: "استثماري طويل المدى (Position)", value: "position" }
        ]
      };
    }
    
    return {
      reply: replyText,
      recommendations: [],
      usageTokens: 0,
      activities: [],
      question: questionBlock
    };
  }

  // 4. Intent Classification
  let activeMsg = messageText;
  if (workflowContext.initial_request && parameterMatched) {
    // Recover user's original command now that parameters are resolved
    activeMsg = workflowContext.initial_request;
  }

  let intent = classifyIntentRuleBased(activeMsg);
  if (!intent) {
    intent = await classifyIntentLLM(activeMsg);
  }
  await logCopilotEvent(userId, conversationId, "intent_classified", { message: activeMsg, intent });

  // 5. Parameter Validation Gating for Trades & Analysis
  const hasImage = options?.hasImage || history.some(m => Array.isArray(m.content) && m.content.some(b => b.type === "image"));

  if (!hasImage && (intent === "Trade Execution" || intent === "Market Analysis")) {
    // Parse message for timeframe or strategy keywords first to fill context
    const msgLower = activeMsg.toLowerCase();
    
    // Auto-extract timeframe if present in message
    if (!workflowContext.timeframe) {
      if (msgLower.includes("15m") || msgLower.includes("15 دقيقة") || msgLower.includes("ربع ساعة")) workflowContext.timeframe = "15m";
      else if (msgLower.includes("1h") || msgLower.includes("ساعة")) workflowContext.timeframe = "1h";
      else if (msgLower.includes("4h") || msgLower.includes("4 ساعات")) workflowContext.timeframe = "4h";
      else if (msgLower.includes("1d") || msgLower.includes("يوم")) workflowContext.timeframe = "1d";
    }
    
    // Auto-extract trading style if present
    if (!workflowContext.trading_style) {
      if (msgLower.includes("scalp") || msgLower.includes("سكالب")) workflowContext.trading_style = "scalp";
      else if (msgLower.includes("day") || msgLower.includes("يومي")) workflowContext.trading_style = "day";
      else if (msgLower.includes("swing") || msgLower.includes("سوينج")) workflowContext.trading_style = "swing";
      else if (msgLower.includes("position") || msgLower.includes("استثمار")) workflowContext.trading_style = "position";
    }

    // No robotic re-asking: the agent is the decision maker. Resolve timeframe
    // and style from the user's already-chosen settings (welcome screen / message)
    // with sensible defaults, then let the agent proceed. If it genuinely needs a
    // missing detail it asks naturally in conversation — not via a forced selector.
    workflowContext.timeframe =
      workflowContext.timeframe || settings.analysis_interval || "1h";
    workflowContext.trading_style =
      workflowContext.trading_style || settings.trading_style || "day";
  }

  // Clear workflow state now that all parameters are resolved
  await updateConversationWorkflow(conversationId, userId, null, {});
  if (parameterMatched) {
    await logCopilotEvent(userId, conversationId, "workflow_completed", { context: workflowContext });
  }

  // 6. Full agent capability (MCP parity).
  // The platform agent must be a complete agent with the SAME tools as the MCP
  // server (and more) — no intent-based whitelist crippling it. The agent itself
  // decides which tools fit the conversation. Execution stays fully gated by
  // Risk Guard / executeIntent, so full tool access does not bypass any safety.
  const allowedTools: string[] | undefined = undefined;

  // 7. Execute Reasoning (runAgent)
  const agentCtx = { userId, settings };
  const runOpts: RunAgentOptions = {
    ...options,
    allowedTools
  };

  const result = await runAgent(agentCtx, history, runOpts);

  // 8. Safety Protections & Risk Validation Auditing
  if (result.recommendations && result.recommendations.length > 0) {
    try {
      const limits = await getLimits(userId);
      const countOpen = await countOpenTrades(userId);
      
      for (const rec of result.recommendations) {
        if (rec.action === "buy" || rec.action === "sell") {
          const recAny = rec as any;
          const proposed = {
            symbol: rec.symbol,
            side: rec.action,
            notional: recAny.size_pct ? (settings.max_capital * recAny.size_pct) / 100 : (settings.max_capital * settings.per_trade_pct) / 100,
            market: settings.active_market,
            marketType: recAny.market_type ?? "spot",
            leverage: recAny.leverage ?? 1,
            stopLoss: rec.stop_loss,
            confidence: rec.confidence ?? 100
          };
          
          const riskCtx = {
            masterKill: false,
            openTradesCount: countOpen,
            todayRealizedPnlPct: 0,
            todayRealizedPnlUsd: 0,
            monthRealizedPnlPct: 0,
            practiceMode: settings.mode !== "auto",
            envPreference: settings.execution_env_preference as any ?? "demo"
          };
          
          const decision = evaluateTrade(settings, limits, proposed, riskCtx);
          await logCopilotEvent(userId, conversationId, "risk_validation", {
            proposed,
            decision
          });
        }
      }
    } catch (e) {
      console.error("Failed to run risk validation audit:", e);
    }
  }

  return result;
}
