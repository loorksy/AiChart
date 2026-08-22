/**
 * Telegram execution flow — the same short path as the web modal:
 * press execute, adjust the lots, press again, read the number.
 *
 * Every press is a HUMAN tap on an inline button; the agent never composes
 * these callbacks and cannot reach this module (the manual-execution guard
 * pins that). All real guards live server-side in lib/execution — this file
 * only renders menus and translates the short refusal codes.
 *
 * Callback grammar (compact — Telegram caps callback_data at 64 bytes):
 *   xq:<rec>                 open the volume menu for a recommendation
 *   xv:<rec>:<centi>:<nonce> re-render the menu at a new size (± taps)
 *   xg:<rec>:<centi>:<nonce> execute at centi/100 lots
 *   xx                       close the menu
 * The nonce is minted ONCE when the menu opens and carried through every ±
 * tap, so the execute press has a stable idempotency key: a double tap is
 * one order by construction.
 */
import { t } from "@/lib/i18n";
import { DATA_SYMBOL } from "@/lib/gold";
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
  type InlineButton,
} from "@/lib/telegram";
import {
  buildExecutionContext,
  executeRecommendation,
  type ExecutionRefusalCode,
} from "@/lib/execution/orders";
import { roundToStep } from "@/lib/execution/volume";

export const EXECUTION_CALLBACK_PREFIXES = ["xq:", "xv:", "xg:", "xx"] as const;

export function isExecutionCallback(data: string): boolean {
  return EXECUTION_CALLBACK_PREFIXES.some(
    (prefix) => data === prefix || data.startsWith(prefix),
  );
}

function refusalText(code: ExecutionRefusalCode | string): string {
  const key = `exec.err.${code}`;
  const text = t("ar", key);
  return text === key ? t("ar", "exec.err.metaapi_error") : text;
}

function newNonce(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * The button row for a freshly delivered recommendation — present ONLY when
 * the server says this user can execute this plan right now. Errors mean no
 * button, never a broken one.
 */
export async function executionButtonRow(
  userId: number,
  recommendationId: number | string | null | undefined,
): Promise<InlineButton[][]> {
  if (recommendationId == null) return [];
  try {
    const context = await buildExecutionContext(userId, String(recommendationId));
    if (!context.executable) return [];
    return [[{ text: `⚡ ${t("ar", "exec.button")}`, callback_data: `xq:${recommendationId}` }]];
  } catch {
    return [];
  }
}

interface MenuState {
  recommendationId: string;
  centiVolume: number;
  nonce: string;
}

function menuText(input: {
  direction: "buy" | "sell";
  symbol: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  volume: number;
  balance: number | null;
  currency: string | null;
}): string {
  const lines = [
    `<b>${input.symbol} ${t("ar", input.direction === "sell" ? "decision.sell" : "decision.buy")}</b>`,
    t("ar", "exec.menu.levels", {
      entry: String(input.entry ?? "—"),
      stop: String(input.stopLoss ?? "—"),
      tp: String(input.takeProfit ?? "—"),
    }),
    t("ar", "exec.menu.volume", { volume: String(input.volume) }),
  ];
  if (input.balance != null) {
    lines.push(
      t("ar", "exec.menu.balance", {
        balance: String(input.balance),
        currency: input.currency ?? "",
      }),
    );
  }
  return lines.join("\n");
}

function menuKeyboard(state: MenuState, volume: number, step: number): InlineButton[][] {
  const minus = Math.max(1, Math.round((volume - step) * 100));
  const plus = Math.round((volume + step) * 100);
  return [
    [
      { text: "−", callback_data: `xv:${state.recommendationId}:${minus}:${state.nonce}` },
      { text: `${volume}`, callback_data: "xx" },
      { text: "+", callback_data: `xv:${state.recommendationId}:${plus}:${state.nonce}` },
    ],
    [
      {
        text: `⚡ ${t("ar", "exec.confirm", { volume: String(volume) })}`,
        callback_data: `xg:${state.recommendationId}:${Math.round(volume * 100)}:${state.nonce}`,
      },
    ],
    [{ text: t("ar", "exec.cancel"), callback_data: "xx" }],
  ];
}

export interface ExecutionCallbackInput {
  userId: number;
  chatId: string;
  messageId: number;
  callbackId: string;
  data: string;
}

/**
 * One tapped execution button. Returns true when the callback was one of
 * ours (handled or refused) — the webhook then stops routing it anywhere.
 */
export async function handleExecutionCallback(
  input: ExecutionCallbackInput,
): Promise<boolean> {
  const { data } = input;
  if (!isExecutionCallback(data)) return false;

  if (data === "xx") {
    await answerCallbackQuery(input.callbackId).catch(() => {});
    await editMessageText(input.chatId, input.messageId, t("ar", "exec.cancelled")).catch(
      () => {},
    );
    return true;
  }

  if (data.startsWith("xq:")) {
    const recommendationId = data.slice(3);
    const context = await buildExecutionContext(input.userId, recommendationId);
    if (!context.executable) {
      await answerCallbackQuery(
        input.callbackId,
        refusalText(context.refusal ?? "metaapi_error"),
      ).catch(() => {});
      return true;
    }
    await answerCallbackQuery(input.callbackId).catch(() => {});
    const state: MenuState = {
      recommendationId,
      centiVolume: Math.round((context.suggestedVolume ?? 0.01) * 100),
      nonce: newNonce(),
    };
    const volume = state.centiVolume / 100;
    await sendMessage(
      input.chatId,
      menuText({
        direction: context.direction ?? "buy",
        symbol: context.symbol ?? DATA_SYMBOL,
        entry: context.entry ?? null,
        stopLoss: context.stopLoss ?? null,
        takeProfit: context.takeProfit ?? null,
        volume,
        balance: context.balance ?? null,
        currency: context.currency ?? null,
      }),
      menuKeyboard(state, volume, context.volumeStep ?? 0.01),
    ).catch(() => {});
    return true;
  }

  const parts = data.split(":");
  if (data.startsWith("xv:") && parts.length === 4) {
    const [, recommendationId, centiRaw, nonce] = parts;
    const context = await buildExecutionContext(input.userId, recommendationId!);
    if (!context.executable) {
      await answerCallbackQuery(
        input.callbackId,
        refusalText(context.refusal ?? "metaapi_error"),
      ).catch(() => {});
      return true;
    }
    const step = context.volumeStep ?? 0.01;
    const min = context.minVolume ?? step;
    const max = context.maxVolume ?? 100;
    const requested = Number(centiRaw) / 100;
    const volume = roundToStep(Math.min(max, Math.max(min, requested)), step);
    await answerCallbackQuery(input.callbackId).catch(() => {});
    await editMessageText(
      input.chatId,
      input.messageId,
      menuText({
        direction: context.direction ?? "buy",
        symbol: context.symbol ?? DATA_SYMBOL,
        entry: context.entry ?? null,
        stopLoss: context.stopLoss ?? null,
        takeProfit: context.takeProfit ?? null,
        volume,
        balance: context.balance ?? null,
        currency: context.currency ?? null,
      }),
      {
        parseMode: "HTML",
        buttons: menuKeyboard(
          { recommendationId: recommendationId!, centiVolume: Math.round(volume * 100), nonce: nonce! },
          volume,
          step,
        ),
      },
    ).catch(() => {});
    return true;
  }

  if (data.startsWith("xg:") && parts.length === 4) {
    const [, recommendationId, centiRaw, nonce] = parts;
    const volume = Number(centiRaw) / 100;
    await answerCallbackQuery(input.callbackId).catch(() => {});
    const result = await executeRecommendation({
      userId: input.userId,
      recommendationId: recommendationId!,
      volume,
      // Stable across ± edits AND double taps: the menu's one nonce.
      idempotencyKey: `tg-${input.userId}-${recommendationId}-${nonce}`,
    });
    const text = result.ok
      ? result.execution.executed_price != null
        ? `✅ ${t("ar", "exec.done", {
            direction: t("ar", result.execution.direction === "sell" ? "decision.sell" : "decision.buy"),
            volume: String(result.execution.volume),
            price: String(result.execution.executed_price),
          })}${
            result.execution.slippage != null
              ? ` (${t("ar", "exec.done.slippage", { slippage: String(result.execution.slippage) })})`
              : ""
          }`
        : `✅ ${t("ar", "exec.done.pending_price")}`
      : `⛔ ${refusalText(result.code)}`;
    await editMessageText(input.chatId, input.messageId, text).catch(() => {});
    return true;
  }

  await answerCallbackQuery(input.callbackId).catch(() => {});
  return true;
}
