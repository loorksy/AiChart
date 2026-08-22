/**
 * The ONE order path — every surface (web modal, Telegram button, MCP tool)
 * lands here, and nothing else in the product may import this module's send.
 *
 * Hard guarantees, each tested:
 *  - linked account or refusal: hiding the button is UI; the SERVER refuses;
 *  - a recommendation past its validity, closed, or not currently executable
 *    is refused with a short named reason;
 *  - the volume the user chose is re-validated server-side against the
 *    broker's own bounds and the account's free margin;
 *  - one press = one order: UNIQUE idempotency key AND a one-live-order rule
 *    per recommendation, whichever key the retry carried;
 *  - the stop loss travels IN the order request (payload builder refuses
 *    otherwise);
 *  - a lost response is `unconfirmed`, and reconciliation queries the broker
 *    by clientId before anything may be resent — no orphans, no duplicates;
 *  - every attempt is a ledger row: who, plan, account, volume, prices,
 *    slippage, outcome. The agent's performance record never reads it.
 */
import { createLogger } from "@/lib/logger";
import { getBrokerLink } from "@/lib/brokerLink/store";
import { readAccount } from "@/lib/brokerLink/metaapiClient";
import { metaapiRegion, metaapiToken } from "@/lib/brokerLink/token";
import { getTrackedRecommendation } from "@/lib/recommendations/recommendationStore";
import type { TrackedRecommendation } from "@/lib/recommendations/types";
import { getForexLiveQuote } from "@/lib/markets/forexPrice";
import { logAudit } from "@/lib/store";
import { getSettings } from "@/lib/store";
import { coerceToGold } from "@/lib/gold";
import {
  findByClientId,
  getAccountInformation,
  getSymbolSpecification,
  MetaapiTradeError,
  placeMarketOrder,
  tradeErrorCode,
  type AccountInformation,
  type SymbolSpecification,
  type TradeApiAuth,
} from "./metaapiTrade";
import {
  approxRequiredMargin,
  suggestVolume,
  validateVolume,
} from "./volume";
import {
  claimExecution,
  findLiveExecution,
  getExecutionById,
  markFailed,
  markFilled,
  markRejected,
  markSent,
  markUnconfirmed,
  type ExecutionRow,
} from "./store";

const log = createLogger("execution.orders");

/** Short factual refusal codes — surfaces translate, nobody lectures. */
export type ExecutionRefusalCode =
  | "not_linked"
  | "metaapi_unconfigured"
  | "recommendation_not_found"
  | "recommendation_closed"
  | "recommendation_expired"
  | "awaiting_activation"
  | "plan_blocked"
  | "missing_stop"
  | "invalid_volume"
  | "insufficient_margin"
  | "already_executed"
  | "market_closed"
  | "trade_disabled"
  | "invalid_stops"
  | "broker_rejected"
  | "send_unconfirmed"
  | "metaapi_auth"
  | "metaapi_error";

export interface ExecutionRefusal {
  ok: false;
  code: ExecutionRefusalCode;
  detail?: string;
  /** Present when the refusal points at an existing attempt (duplicates). */
  execution?: ExecutionRow;
}

export interface ExecutionSuccess {
  ok: true;
  execution: ExecutionRow;
}

export type ExecutionOutcome = ExecutionSuccess | ExecutionRefusal;

export interface ExecutionDeps {
  now?: () => number;
  getLink?: typeof getBrokerLink;
  getToken?: typeof metaapiToken;
  getRegionFallback?: typeof metaapiRegion;
  readAccountInfo?: typeof readAccount;
  getRecommendation?: typeof getTrackedRecommendation;
  getUserSettings?: typeof getSettings;
  accountInformation?: typeof getAccountInformation;
  symbolSpecification?: typeof getSymbolSpecification;
  livePrice?: (userId: number, symbol: string) => Promise<number | null>;
  sendOrder?: typeof placeMarketOrder;
  lookupClientId?: typeof findByClientId;
}

async function defaultLivePrice(userId: number, symbol: string): Promise<number | null> {
  try {
    const quote = await getForexLiveQuote(userId, symbol, { timeoutMs: 3_000 });
    return quote ? (quote.bid + quote.ask) / 2 : null;
  } catch {
    return null;
  }
}

interface LinkedAuth {
  auth: TradeApiAuth;
  accountId: string;
}

/** Linked, deployed, token present — or the named refusal. Shared with the monitor. */
export async function resolveExecutionAuth(
  userId: number,
  deps: ExecutionDeps,
): Promise<LinkedAuth | ExecutionRefusal> {
  const link = await (deps.getLink ?? getBrokerLink)(userId);
  if (!link) return { ok: false, code: "not_linked" };
  const token = await (deps.getToken ?? metaapiToken)();
  if (!token) return { ok: false, code: "metaapi_unconfigured" };
  let region: string | null = null;
  try {
    const account = await (deps.readAccountInfo ?? readAccount)({
      token,
      accountId: link.metaapi_account_id,
    });
    if (account.state !== "DEPLOYED") {
      return { ok: false, code: "not_linked", detail: `account state ${account.state}` };
    }
    region = account.region;
  } catch (error) {
    return {
      ok: false,
      code: "metaapi_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const fallback = await (deps.getRegionFallback ?? metaapiRegion)();
  return {
    accountId: link.metaapi_account_id,
    auth: {
      token,
      accountId: link.metaapi_account_id,
      region: region ?? fallback ?? "london",
    },
  };
}

/** The validity gate: only a live, currently-executable plan may execute. */
function recommendationRefusal(
  rec: TrackedRecommendation | null,
  now: number,
): ExecutionRefusal | null {
  if (!rec) return { ok: false, code: "recommendation_not_found" };
  if (rec.outcome !== "pending") {
    return { ok: false, code: "recommendation_closed", detail: rec.outcome };
  }
  if (rec.executionState === "expired" || now > rec.expiresAt) {
    return { ok: false, code: "recommendation_expired" };
  }
  if (rec.executionState === "invalidated" || rec.executionState === "blocked") {
    return { ok: false, code: "plan_blocked", detail: rec.executionState ?? undefined };
  }
  // NO auto-execution of any kind (owner rule): a plan still waiting for its
  // activation is not executable by a press NOW, and parking a pending order
  // at the broker would fill later with nobody pressing anything.
  if (rec.executionState !== "valid_now" && rec.status !== "triggered") {
    return { ok: false, code: "awaiting_activation" };
  }
  if (!Number.isFinite(rec.stopLoss) || rec.stopLoss <= 0) {
    return { ok: false, code: "missing_stop" };
  }
  return null;
}

export interface ExecutionContext {
  linked: boolean;
  executable: boolean;
  refusal?: ExecutionRefusalCode;
  refusalDetail?: string;
  suggestedVolume?: number;
  minVolume?: number;
  maxVolume?: number;
  volumeStep?: number;
  balance?: number;
  currency?: string;
  riskPct?: number;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number | null;
  direction?: "buy" | "sell";
  symbol?: string;
  expiresAt?: number;
  /** A still-live earlier attempt for this plan, when one exists. */
  existingExecution?: ExecutionRow | null;
}

/**
 * Everything the execute modal needs, decided SERVER-side: whether the
 * button exists at all, and the precomputed size the user then adjusts.
 */
export async function buildExecutionContext(
  userId: number,
  recommendationId: string,
  deps: ExecutionDeps = {},
): Promise<ExecutionContext> {
  const now = (deps.now ?? Date.now)();
  const resolved = await resolveExecutionAuth(userId, deps);
  if ("ok" in resolved) {
    return { linked: false, executable: false, refusal: resolved.code, refusalDetail: resolved.detail };
  }
  const rec = await (deps.getRecommendation ?? getTrackedRecommendation)(
    userId,
    recommendationId,
  );
  const refusal = rec ? recommendationRefusal(rec, now) : { ok: false as const, code: "recommendation_not_found" as const };
  const base: ExecutionContext = { linked: true, executable: false };
  if (!rec) return { ...base, refusal: "recommendation_not_found" };

  base.direction = rec.direction === "sell" ? "sell" : "buy";
  base.symbol = coerceToGold(rec.symbol);
  base.entry = rec.entry;
  base.stopLoss = rec.stopLoss;
  base.takeProfit = rec.targets[0] ?? null;
  base.expiresAt = rec.expiresAt;
  base.existingExecution = await findLiveExecution(userId, rec.canonicalId ?? Number(rec.id));

  if (refusal) {
    return { ...base, refusal: refusal.code, refusalDetail: refusal.detail };
  }

  try {
    const [info, spec, settings] = await Promise.all([
      (deps.accountInformation ?? getAccountInformation)(resolved.auth),
      (deps.symbolSpecification ?? getSymbolSpecification)(resolved.auth, base.symbol!),
      (deps.getUserSettings ?? getSettings)(userId),
    ]);
    const riskPct = Number(settings.per_trade_pct) || 1;
    const suggestion = suggestVolume({
      balance: info.balance,
      riskPct,
      entry: rec.entry,
      stopLoss: rec.stopLoss,
      contractSize: spec.contractSize,
      minVolume: spec.minVolume,
      maxVolume: spec.maxVolume,
      volumeStep: spec.volumeStep,
    });
    return {
      ...base,
      executable: base.existingExecution == null,
      refusal: base.existingExecution ? "already_executed" : undefined,
      suggestedVolume: suggestion.volume,
      minVolume: spec.minVolume,
      maxVolume: spec.maxVolume,
      volumeStep: spec.volumeStep,
      balance: info.balance,
      currency: info.currency,
      riskPct,
    };
  } catch (error) {
    return {
      ...base,
      refusal: "metaapi_error",
      refusalDetail: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface ExecuteInput {
  userId: number;
  recommendationId: string;
  volume: number;
  idempotencyKey: string;
}

/**
 * Reconcile an attempt whose send outcome is unknown: ask the broker whether
 * anything carrying our clientId exists. Found → filled (with the broker's
 * own price). Absent → failed(send_unconfirmed_absent), which is the ONLY
 * state from which a fresh press may send again.
 */
export async function reconcileExecution(
  row: ExecutionRow,
  auth: TradeApiAuth,
  deps: ExecutionDeps = {},
): Promise<ExecutionRow> {
  if (row.state !== "unconfirmed" && row.state !== "sent") return row;
  try {
    const found = await (deps.lookupClientId ?? findByClientId)(
      auth,
      row.client_id,
      (deps.now ?? Date.now)(),
    );
    if (found.position) {
      const executed = found.position.openPrice;
      await markFilled(row.id, {
        executedPrice: executed,
        slippage:
          executed != null && row.requested_price != null
            ? Number((executed - row.requested_price).toFixed(3))
            : null,
        brokerPositionId: found.position.id,
      });
    } else if (found.deal) {
      await markFilled(row.id, {
        executedPrice: found.deal.price,
        slippage:
          found.deal.price != null && row.requested_price != null
            ? Number((found.deal.price - row.requested_price).toFixed(3))
            : null,
        brokerPositionId: found.deal.positionId,
        brokerOrderId: found.deal.orderId,
      });
    } else {
      await markFailed(
        row.id,
        "send_unconfirmed_absent",
        "the broker holds nothing with this clientId — the order never arrived",
      );
    }
  } catch (error) {
    // The broker was unreachable for the CHECK too — the attempt stays
    // unconfirmed and keeps blocking resends. Never guess it away.
    log.warn("execution reconcile failed", {
      executionId: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return row;
  }
  return (await getExecutionById(row.user_id, row.id)) ?? row;
}

/**
 * The press. Runs every guard, claims the idempotency key, sends ONE market
 * order with its stop in the same request, and records the outcome.
 */
export async function executeRecommendation(
  input: ExecuteInput,
  deps: ExecutionDeps = {},
): Promise<ExecutionOutcome> {
  const now = (deps.now ?? Date.now)();

  const resolved = await resolveExecutionAuth(input.userId, deps);
  if ("ok" in resolved) return resolved;

  const rec = await (deps.getRecommendation ?? getTrackedRecommendation)(
    input.userId,
    input.recommendationId,
  );
  const refused = recommendationRefusal(rec, now);
  if (refused) return refused;
  const plan = rec!;
  const canonicalId = plan.canonicalId ?? Number(plan.id);
  const symbol = coerceToGold(plan.symbol);
  const direction: "buy" | "sell" = plan.direction === "sell" ? "sell" : "buy";

  // A prior press with a DIFFERENT key still owns this plan: reconcile it if
  // its send was lost, and only a broker-confirmed absence frees the plan.
  const live = await findLiveExecution(input.userId, canonicalId);
  if (live && live.idempotency_key !== input.idempotencyKey) {
    const settled = await reconcileExecution(live, resolved.auth, deps);
    if (
      settled.state === "pending" ||
      settled.state === "sent" ||
      settled.state === "unconfirmed" ||
      settled.state === "filled"
    ) {
      return { ok: false, code: "already_executed", execution: settled };
    }
  }

  let info: AccountInformation;
  let spec: SymbolSpecification;
  try {
    [info, spec] = await Promise.all([
      (deps.accountInformation ?? getAccountInformation)(resolved.auth),
      (deps.symbolSpecification ?? getSymbolSpecification)(resolved.auth, symbol),
    ]);
  } catch (error) {
    return {
      ok: false,
      code: error instanceof MetaapiTradeError ? (error.code as ExecutionRefusalCode) : "metaapi_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const volumeCheck = validateVolume(input.volume, spec);
  if (!volumeCheck.ok) {
    return { ok: false, code: "invalid_volume", detail: volumeCheck.detail };
  }
  const volume = volumeCheck.volume;

  const requestedPrice =
    (await (deps.livePrice ?? defaultLivePrice)(input.userId, symbol)) ?? plan.entry;
  const margin = approxRequiredMargin({
    volume,
    contractSize: spec.contractSize,
    price: requestedPrice,
    leverage: info.leverage,
  });
  const freeMargin = info.freeMargin ?? info.balance;
  if (margin != null && margin > freeMargin) {
    return {
      ok: false,
      code: "insufficient_margin",
      detail: `needs ~${Math.round(margin)} ${info.currency}, free ${Math.round(freeMargin)}`,
    };
  }

  const takeProfit = plan.targets[0] ?? null;
  const { row, claimed } = await claimExecution({
    userId: input.userId,
    recommendationId: canonicalId,
    idempotencyKey: input.idempotencyKey,
    clientId: `LON_${input.userId}_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    metaapiAccountId: resolved.accountId,
    symbol,
    direction,
    volume,
    stopLoss: plan.stopLoss,
    takeProfit,
    requestedPrice,
    now,
  });

  // The same key pressed twice: the first attempt IS the answer, whatever
  // state it reached. An unconfirmed one is reconciled, never resent; one
  // still in flight is reported as the duplicate it is, never sent again.
  if (!claimed) {
    if (row.state === "unconfirmed" || row.state === "sent") {
      const settled = await reconcileExecution(row, resolved.auth, deps);
      return settled.state === "filled"
        ? { ok: true, execution: settled }
        : { ok: false, code: "send_unconfirmed", execution: settled };
    }
    if (row.state === "filled") {
      return { ok: true, execution: row };
    }
    if (row.state === "pending") {
      return { ok: false, code: "already_executed", execution: row };
    }
    return {
      ok: false,
      code: (row.error_code as ExecutionRefusalCode) || "broker_rejected",
      detail: row.error_message ?? undefined,
      execution: row,
    };
  }

  await markSent(row.id, now);
  try {
    const response = await (deps.sendOrder ?? placeMarketOrder)(resolved.auth, {
      direction,
      symbol,
      volume,
      stopLoss: plan.stopLoss,
      takeProfit,
      clientId: row.client_id,
      comment: `LONORA #${canonicalId}`,
    });
    if (!response.ok) {
      const code = tradeErrorCode(response) as ExecutionRefusalCode;
      await markRejected(row.id, code, response.message ?? response.stringCode ?? "rejected");
      const updated = (await getExecutionById(input.userId, row.id)) ?? row;
      return { ok: false, code, detail: response.message ?? undefined, execution: updated };
    }
    // Best-effort executed-price read; the fill stands even when the lookup
    // fails — reconciliation can complete the numbers later.
    let executedPrice: number | null = null;
    let positionId = response.positionId;
    try {
      const found = await (deps.lookupClientId ?? findByClientId)(
        resolved.auth,
        row.client_id,
        now,
      );
      executedPrice = found.position?.openPrice ?? found.deal?.price ?? null;
      positionId = found.position?.id ?? positionId;
    } catch {
      executedPrice = null;
    }
    await markFilled(row.id, {
      executedPrice,
      slippage:
        executedPrice != null && requestedPrice != null
          ? Number((executedPrice - requestedPrice).toFixed(3))
          : null,
      brokerOrderId: response.orderId,
      brokerPositionId: positionId,
    });
    const updated = (await getExecutionById(input.userId, row.id)) ?? row;
    await logAudit(
      input.userId,
      "execution",
      `${symbol} ${direction} ${volume} lots rec#${canonicalId} acct=${resolved.accountId} price=${executedPrice ?? "?"} slip=${updated.slippage ?? "?"} (#${row.id})`,
    ).catch(() => {});
    return { ok: true, execution: updated };
  } catch (error) {
    if (error instanceof MetaapiTradeError && error.code === "send_unconfirmed") {
      // The order MAY have reached the broker. Never assume: mark, then ask.
      await markUnconfirmed(row.id);
      const settled = await reconcileExecution(
        (await getExecutionById(input.userId, row.id)) ?? row,
        resolved.auth,
        deps,
      );
      if (settled.state === "filled") return { ok: true, execution: settled };
      return { ok: false, code: "send_unconfirmed", execution: settled };
    }
    const code =
      error instanceof MetaapiTradeError
        ? (error.code as ExecutionRefusalCode)
        : "metaapi_error";
    await markFailed(
      row.id,
      code,
      error instanceof Error ? error.message : String(error),
    );
    const updated = (await getExecutionById(input.userId, row.id)) ?? row;
    return { ok: false, code, execution: updated };
  }
}
