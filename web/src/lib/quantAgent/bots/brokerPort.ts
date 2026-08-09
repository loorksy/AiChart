/**
 * THE BOT EXECUTION SEAM. Read this before touching anything under
 * `lib/quantAgent/bots/`.
 *
 * Bots do not talk to a venue. When a bot wants an order it goes through
 * `liveExecution.ts` → `createIntent` → `executeIntent`. Every money
 * protection on the platform (kill switch, dual live enablement, stage,
 * sizing, intent lock, portfolio gate) lives inside `executeIntent`. This
 * module answers only the bot-specific questions:
 *
 *   1. Did the deploy turn bot execution on (`QUANT_AGENT_BOT_EXECUTION_ENABLED`)?
 *   2. Did THIS bot's owner move THIS bot to `live`?
 *
 * It does not re-check the kill switch or dual enablement — those have one
 * home, and a second copy of either rule is how one of them drifts.
 *
 * Ordinary refusal returns `{ ok: false, reason }`. Throwing would abort a
 * multi-bot scan that should log one refusal and continue. The
 * `BotExecutionForbiddenError` class remains for call sites that need a 403
 * mapping (e.g. a route that rejects a forbidden verb outright).
 *
 * `QuantBrokerPort` / `resolveQuantBroker` stay unimplemented on purpose: a
 * second path that reaches MetaApi/RPC from under this tree is exactly the
 * failure mode the boundary tests exist to catch.
 */

export const QUANT_BOT_EXECUTION_MODES = ["simulation", "live"] as const;

export type QuantBotExecutionMode = (typeof QUANT_BOT_EXECUTION_MODES)[number];

/** Default for every newly saved bot and every simulation response. */
export const QUANT_BOT_DEFAULT_EXECUTION_MODE: QuantBotExecutionMode = "simulation";

export class BotExecutionForbiddenError extends Error {
  readonly code = "QUANT_BOT_EXECUTION_FORBIDDEN";
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "BotExecutionForbiddenError";
  }
}

export type BotExecutionRefusalCode =
  | "bot_execution_disabled"
  | "bot_simulation_only"
  | "bot_ownership_mismatch";

export type BotExecutionGate =
  | { ok: true }
  | { ok: false; code: BotExecutionRefusalCode; reason: string };

/**
 * Whether the deploy has asked for live bot execution.
 *
 * This is the only bot-specific enable. Account demo/live is read from the
 * linked broker by `executeIntent` — a second demo/live key here would be two
 * answers to one question.
 */
export function botExecutionFlagEnabled(): boolean {
  const raw = (process.env.QUANT_AGENT_BOT_EXECUTION_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isQuantBotExecutionMode(value: unknown): value is QuantBotExecutionMode {
  return value === "simulation" || value === "live";
}

/**
 * The two bot-specific questions. Call before creating an intent.
 *
 * Returns a soft refusal — never throws — so a scan can record the reason and
 * move on to the next bot.
 */
export function assertBotExecutionAllowed(input: {
  userId: number;
  bot: { id: string; ownerUserId: number; executionMode: QuantBotExecutionMode };
  context?: string;
}): BotExecutionGate {
  const where = input.context ? ` (${input.context})` : "";

  if (input.bot.ownerUserId !== input.userId) {
    return {
      ok: false,
      code: "bot_ownership_mismatch",
      reason: `Bot ownership mismatch${where}: refusing to act on another user's bot.`,
    };
  }

  if (!botExecutionFlagEnabled()) {
    return {
      ok: false,
      code: "bot_execution_disabled",
      reason:
        `Bot execution is off at deploy${where}: QUANT_AGENT_BOT_EXECUTION_ENABLED is not set. ` +
        "No intent was created.",
    };
  }

  if (input.bot.executionMode !== "live") {
    return {
      ok: false,
      code: "bot_simulation_only",
      reason:
        `Bot ${input.bot.id} is in simulation${where}: the owner has not moved it to live. ` +
        "No intent was created.",
    };
  }

  return { ok: true };
}

/**
 * The shape a venue-side broker would have. Declared so the boundary test can
 * prove nothing under this tree implements it. Live orders use `executeIntent`.
 */
export interface QuantBrokerPort {
  normalizeQuantity(quantity: number, price: number): number;
  placeLimit(order: {
    clientOrderId: string;
    side: "buy" | "sell";
    price: number;
    quantity: number;
    reduceOnly: boolean;
  }): Promise<{ accepted: boolean; exchangeOrderId: string }>;
  cancel(clientOrderId: string): Promise<boolean>;
  accountLegSize(posSide: "long" | "short"): Promise<number>;
  hedgeMode(): Promise<boolean>;
}

/** There is never a venue broker under this tree. */
export function resolveQuantBroker(context?: string): never {
  const where = context ? ` (${context})` : "";
  throw new BotExecutionForbiddenError(
    `Quant bot modules must not resolve a venue broker${where}. ` +
      "Orders go through createIntent → executeIntent.",
  );
}
