/**
 * The only place a Quant Agent bot may ask for a real order.
 *
 * Flow: assertBotExecutionAllowed → createIntent → executeIntent.
 * Nothing here imports MetaApi, mt5local, RPC, or a broker adapter. Sizing,
 * kill switch, dual live enablement, stage, portfolio gate and the intent
 * lock all live inside `executeIntent` — this module deliberately does not
 * re-implement any of them.
 */
import { executeIntent, type ExecutionResult } from "@/lib/execution";
import { createIntent, logAudit } from "@/lib/store";
import type { AgentActivity } from "@/lib/agentActivity";
import {
  assertBotExecutionAllowed,
  type BotExecutionRefusalCode,
} from "./brokerPort";
import type { QuantBot } from "./types";

export interface BotOrderRequest {
  userId: number;
  bot: QuantBot;
  side: "buy" | "sell";
  /** Defaults to the bot's symbol. */
  symbol?: string;
  entry?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  rationale?: string | null;
}

export type BotOrderResult = {
  botId: string;
  intentId: number | null;
  intentCreated: boolean;
  activities: AgentActivity[];
} & (
  | (ExecutionResult & { ok: true })
  | (ExecutionResult & { ok: false })
  | {
      ok: false;
      status: "failed";
      reason: string;
      errorCode: BotExecutionRefusalCode | string;
    }
);

/**
 * Ask the platform to place one order on behalf of a bot.
 *
 * Soft-fails when the bot is in simulation or the deploy flag is off — no
 * intent is written in those cases, so a scan can record the reason and
 * continue.
 */
export async function executeBotOrder(request: BotOrderRequest): Promise<BotOrderResult> {
  const { userId, bot } = request;
  const gate = assertBotExecutionAllowed({
    userId,
    bot,
    context: `bot:${bot.id}`,
  });
  if (!gate.ok) {
    await logAudit(
      userId,
      "quant_bot_order_refused",
      JSON.stringify({ botId: bot.id, code: gate.code, reason: gate.reason }),
    ).catch(() => undefined);
    return {
      ok: false,
      status: "failed",
      reason: gate.reason,
      errorCode: gate.code,
      botId: bot.id,
      intentId: null,
      intentCreated: false,
      activities: [],
    };
  }

  const symbol = (request.symbol ?? bot.symbol).trim();
  const side = request.side;
  const rationale =
    request.rationale?.trim() ||
    `Quant bot ${bot.id} · standing live authorisation`;

  const intent = await createIntent(userId, {
    bot_id: bot.id,
    authorization_source: "standing_auto",
    symbol,
    side,
    // Sizing is the server's job from verified equity inside executeIntent.
    notional: 0,
    market: "forex",
    entry: request.entry ?? null,
    stop_loss: request.stopLoss ?? null,
    take_profit: request.takeProfit ?? null,
    rationale,
  });

  await logAudit(
    userId,
    "quant_bot_order_intent",
    JSON.stringify({ botId: bot.id, intentId: intent.id, symbol, side }),
  ).catch(() => undefined);

  const result = await executeIntent(userId, intent.id, {
    // Standing bot grant — never a forged per-trade approval.
    explicitApproval: false,
  });

  await logAudit(
    userId,
    result.ok ? "quant_bot_order_executed" : "quant_bot_order_failed",
    JSON.stringify({
      botId: bot.id,
      intentId: intent.id,
      ok: result.ok,
      reason: result.reason,
      tradeId: result.tradeId ?? null,
      errorCode: result.errorCode ?? null,
    }),
  ).catch(() => undefined);

  if (result.ok) {
    return {
      ...result,
      ok: true as const,
      botId: bot.id,
      intentId: intent.id,
      intentCreated: true,
    };
  }
  return {
    ...result,
    ok: false as const,
    botId: bot.id,
    intentId: intent.id,
    intentCreated: true,
  };
}
