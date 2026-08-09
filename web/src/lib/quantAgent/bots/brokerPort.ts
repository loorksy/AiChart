/**
 * THE EXECUTION SEAM. Read this before touching anything under
 * `lib/quantAgent/bots/`.
 *
 * AiChart's Quant Agent bots are a SIMULATION. They replay a configured grid
 * against historical candles and report what would have happened. No bot in
 * this product places an order, and there is no supported way to make one.
 *
 * This module is the single place that would ever have to change for that to
 * stop being true, which is why `assertBotExecutionAllowed()` throws
 * UNCONDITIONALLY — with the environment flag unset, AND with it set to every
 * truthy spelling. The flag is read, reported, and then ignored.
 *
 * That is deliberate, not an oversight:
 *
 *   - A flag that *could* enable execution turns "did we ship live trading?"
 *     into a question about production environment variables. An unconditional
 *     throw makes it a question about the code, which is reviewable, greppable,
 *     and testable.
 *   - Wiring a real broker must therefore be a deliberate diff: someone has to
 *     delete the throw, write a `QuantBrokerPort` implementation, and get both
 *     past review. `lib/quantAgent/__tests__/botExecutionBoundary.test.ts` and
 *     `quant-agent/tests/test_no_execution.py` both fail loudly if either
 *     happens by accident.
 *   - The flag still exists because operators ask "is live trading on?" and
 *     deserve a real answer rather than silence. `botExecutionFlagEnabled()`
 *     answers it. The answer never changes what the code does.
 *
 * quant-agent enforces the same boundary on its side of the wire: its engine
 * talks to a five-method `QuantBrokerPort`, and `SimulatedQuantBroker` is the
 * only implementation of it in the repository.
 */

/** The only execution mode this product has. Not a default — the whole set. */
export const QUANT_BOT_EXECUTION_MODE = "simulation" as const;

export type QuantBotExecutionMode = typeof QUANT_BOT_EXECUTION_MODE;

/**
 * Thrown by {@link assertBotExecutionAllowed}. A distinct class so a route can
 * map it to a 403 without string-matching, and so a `catch` that swallows it
 * is visible in review.
 */
export class BotExecutionForbiddenError extends Error {
  readonly code = "QUANT_BOT_EXECUTION_FORBIDDEN";
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = "BotExecutionForbiddenError";
  }
}

/**
 * Whether an operator has *asked* for live bot execution.
 *
 * Reporting only. Nothing in this codebase branches on it, and
 * {@link assertBotExecutionAllowed} throws whatever it returns.
 */
export function botExecutionFlagEnabled(): boolean {
  const raw = (process.env.QUANT_AGENT_BOT_EXECUTION_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Refuses live bot execution. ALWAYS.
 *
 * Call this at the top of any code path that would submit, modify or cancel a
 * real order on behalf of a bot. There is currently no such path — this exists
 * so that if one is ever written, it fails closed on its first line instead of
 * discovering the boundary at the broker.
 *
 * @throws {BotExecutionForbiddenError} unconditionally.
 */
export function assertBotExecutionAllowed(context?: string): never {
  // The flag is read so the refusal can say whether someone tried to turn this
  // on. It is NOT consulted to decide anything: both branches below throw.
  const requested = botExecutionFlagEnabled();
  const where = context ? ` (${context})` : "";
  throw new BotExecutionForbiddenError(
    requested
      ? `Live bot execution is not implemented in AiChart${where}. ` +
        "QUANT_AGENT_BOT_EXECUTION_ENABLED is set, but no broker is wired: enabling " +
        "execution is a code change under review, never a configuration change. " +
        "Bots run in simulation only."
      : `Live bot execution is not implemented in AiChart${where}. ` +
        "Bots run in simulation only, against historical candles.",
  );
}

/**
 * The shape a real broker would have to implement — mirroring quant-agent's
 * `QuantBrokerPort` five for five.
 *
 * Declared and never implemented, on purpose. It documents the size of the
 * surface someone would be taking on, and it gives
 * {@link assertBotExecutionAllowed} something concrete to guard. If a type in
 * this repository ever satisfies it, that is the change to scrutinise.
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

/**
 * Resolve the broker for a bot. There is never one.
 *
 * Every call site that would need a broker goes through here, so the list of
 * such call sites is `grep resolveQuantBroker` and nothing else.
 */
export function resolveQuantBroker(context?: string): never {
  return assertBotExecutionAllowed(context ?? "resolveQuantBroker");
}
