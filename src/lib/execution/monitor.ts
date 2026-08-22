/**
 * On-demand execution monitoring — read-only, only when asked.
 *
 * Open positions and the recent closed results IN MONEY, straight from the
 * broker through the user's own linked account. No streaming, no schedule,
 * no writes: a question answered when the user asks it. None of this ever
 * feeds the recommendation record — the agent is graded on its plans, not
 * on what anyone executed.
 */
import {
  listDealsByTimeRange,
  listPositions,
  type BrokerDeal,
  type BrokerPosition,
} from "./metaapiTrade";
import {
  reconcileExecution,
  resolveExecutionAuth,
  type ExecutionDeps,
  type ExecutionRefusalCode,
} from "./orders";
import { findLiveExecution, listExecutions, type ExecutionRow } from "./store";

export interface ClosedTrade {
  positionId: string | null;
  symbol: string;
  volume: number | null;
  closePrice: number | null;
  /** The money answer: profit + swap + commission of the closing deal. */
  netProfit: number | null;
  closedAt: string | null;
}

export interface ExecutionTradesView {
  linked: boolean;
  refusal?: ExecutionRefusalCode;
  refusalDetail?: string;
  open: BrokerPosition[];
  closed: ClosedTrade[];
  /** Sum of `netProfit` over the closed window (account currency). */
  closedNetTotal: number;
  /** This platform's own execution ledger rows (audit, newest first). */
  executions: ExecutionRow[];
}

function toClosedTrade(deal: BrokerDeal): ClosedTrade {
  const parts = [deal.profit, deal.swap, deal.commission].filter(
    (value): value is number => value != null,
  );
  return {
    positionId: deal.positionId,
    symbol: deal.symbol,
    volume: deal.volume,
    closePrice: deal.price,
    netProfit: parts.length ? Number(parts.reduce((a, b) => a + b, 0).toFixed(2)) : null,
    closedAt: deal.time,
  };
}

export interface ExecutionTradesInput {
  userId: number;
  /** Closed-trades window, days back from now (default 7, max 30). */
  days?: number;
}

export async function getExecutionTrades(
  input: ExecutionTradesInput,
  deps: ExecutionDeps & {
    positions?: typeof listPositions;
    deals?: typeof listDealsByTimeRange;
  } = {},
): Promise<ExecutionTradesView> {
  const empty: ExecutionTradesView = {
    linked: false,
    open: [],
    closed: [],
    closedNetTotal: 0,
    executions: [],
  };
  const resolved = await resolveExecutionAuth(input.userId, deps);
  if ("ok" in resolved) {
    return { ...empty, refusal: resolved.code, refusalDetail: resolved.detail };
  }
  const now = (deps.now ?? Date.now)();
  const days = Math.max(1, Math.min(30, input.days ?? 7));

  // Settle any attempt whose send outcome was never confirmed — the view is
  // exactly when the user is looking, and a stale "unconfirmed" is a lie.
  const executions = await listExecutions(input.userId, 50);
  for (const row of executions) {
    if (row.state === "unconfirmed") {
      await reconcileExecution(row, resolved.auth, deps);
    }
  }

  const [open, deals] = await Promise.all([
    (deps.positions ?? listPositions)(resolved.auth),
    (deps.deals ?? listDealsByTimeRange)(
      resolved.auth,
      now - days * 24 * 3_600_000,
      now,
    ),
  ]);
  // Money is realized on the OUT side of a position's deals.
  const closed = deals
    .filter((deal) => deal.entryType === "DEAL_ENTRY_OUT")
    .map(toClosedTrade);
  const closedNetTotal = Number(
    closed
      .reduce((sum, trade) => sum + (trade.netProfit ?? 0), 0)
      .toFixed(2),
  );
  return {
    linked: true,
    open,
    closed,
    closedNetTotal,
    executions: await listExecutions(input.userId, 50),
  };
}

/** Re-exported for surfaces that only need the one-live-order check. */
export { findLiveExecution };
