/**
 * Trade management after a position is open (docs/UNIFIED_AGENT_PLAN.md §14).
 *
 * A revision landing on a plan whose trade is ALREADY filled is only half a
 * change: the recommendation's history moved, but the broker is still guarding
 * the old stop and the old target. This module closes that gap — and nothing
 * more. It never decides a level (the levels come from the revision the brain
 * already produced), it never rewrites history (the sync is recorded as one
 * more append-only revision, source `trade_management`), and it reaches the
 * broker exclusively through the existing SL/TP modify path.
 *
 * Two modes, mirroring execution authorisation:
 *  - advisory — a pending approval intent is created (the same intent + card
 *    machinery a trade approval uses) and the operator is notified. Nothing
 *    touches the broker until they approve.
 *  - auto     — the operator's standing grant is live AND the rollout stage
 *    permits, so the modify command is queued directly and the operator is
 *    told what changed and why.
 */
import { query, queryOne } from "@/lib/db";
import { createIntent, updateIntentStatus } from "@/lib/store";
import { dispatchAlert, type DispatchAlertOptions } from "@/lib/alerts";
import { queueEaModifySlTp } from "@/lib/eaTradeCommands";
import { buildApprovalButtons } from "@/lib/telegramCommands";
import { isAutoExecutionAuthorized } from "@/lib/agent/tradeMode";
import { getResolvedExecutionEnv } from "@/lib/executionEnv";
import { autoExecutionStage, type AutoExecutionStage } from "./autoExecutor";
import {
  applyRecommendationRevision,
  getEffectiveRevision,
  type RecommendationRevision,
} from "./canonical/revisions";
import { appendRecommendationHistory } from "./canonical/repository";
import { createLogger } from "@/lib/logger";
import type { TradeIntent } from "@/lib/types";

const log = createLogger("recommendations:trade-management");

export type TradeManagementAction =
  | "none"
  | "approval_requested"
  | "auto_modified";

export interface TradeManagementOutcome {
  action: TradeManagementAction;
  /** Operator-readable why, whatever happened. */
  reason: string;
  /** The pending approval intent, when one was created. */
  intentId?: number;
  /** The queued EA modify command, when the standing grant applied it. */
  commandId?: number;
  /** The trade_management revision recorded after a broker sync. */
  revisionNo?: number;
}

/** Injectable seams so tests exercise the flow without a live broker/Telegram. */
export interface TradeManagementDeps {
  isAutoAuthorized?: (userId: number) => Promise<boolean>;
  stage?: () => AutoExecutionStage;
  resolveEnv?: (userId: number) => Promise<string | null>;
  queueModify?: (
    userId: number,
    ticket: number,
    stopLoss: number,
    takeProfit?: number | null,
  ) => Promise<{ id: number }>;
  notify?: (userId: number, opts: DispatchAlertOptions) => Promise<unknown>;
}

interface OpenTradeRow {
  trade_id: number;
  order_id: string | null;
  broker: string;
  intent_id: number;
  executed_stop: number | null;
  executed_tp: number | null;
}

/**
 * The open trade linked to a recommendation, with the levels it was executed
 * at. The linkage is trade_intents.recommendation_id → trades.intent_id, the
 * same join the performance journal reads.
 */
async function findOpenLinkedTrade(
  userId: number,
  recommendationId: number,
): Promise<OpenTradeRow | null> {
  return queryOne<OpenTradeRow>(
    `SELECT t.id AS trade_id, t.order_id, t.broker,
            i.id AS intent_id, i.stop_loss AS executed_stop, i.take_profit AS executed_tp
       FROM trades t
       JOIN trade_intents i ON i.id = t.intent_id
      WHERE t.user_id = ? AND i.recommendation_id = ? AND t.status = 'open'
      ORDER BY t.id DESC LIMIT 1`,
    [userId, recommendationId],
  ).catch(() => null);
}

/** Price equality at instrument scale — a float artefact is not a level change. */
function samePrice(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= scale * 1e-6;
}

/**
 * Whether the rollout stage allows the standing grant to touch a live broker.
 * Mirrors the auto executor: `dry_run` and `off` never send; `demo` sends only
 * to an account the broker itself reports as demo.
 */
async function stagePermitsAutoModify(
  userId: number,
  deps: TradeManagementDeps,
): Promise<boolean> {
  const stage = (deps.stage ?? autoExecutionStage)();
  if (stage === "live") return true;
  if (stage === "demo") {
    const env = await (deps.resolveEnv
      ? deps.resolveEnv(userId)
      : getResolvedExecutionEnv(userId, "forex").catch(() => null));
    return env === "demo";
  }
  return false;
}

/** The SL/TP the revision asks for, versus what the trade was executed with. */
function computeDeltas(revision: RecommendationRevision, trade: OpenTradeRow): {
  newStop: number | null;
  newTp: number | null;
  stopChanged: boolean;
  tpChanged: boolean;
} {
  const newStop = revision.stopLoss ?? null;
  const newTp = revision.targets[0] ?? null;
  return {
    newStop,
    newTp,
    stopChanged: newStop != null && !samePrice(newStop, trade.executed_stop),
    tpChanged: newTp != null && !samePrice(newTp, trade.executed_tp),
  };
}

/**
 * Record the broker sync as one more append-only revision.
 *
 * The levels are COPIED from the revision that triggered the sync — this
 * module holds no opinion of its own — so the effective plan is unchanged and
 * the history gains an honest line: "the open position was brought in line
 * with revision N".
 */
async function recordSyncRevision(input: {
  userId: number;
  recommendationId: number;
  revision: RecommendationRevision;
  trade: OpenTradeRow;
  commandId: number;
  reason: string;
}): Promise<RecommendationRevision | null> {
  const r = input.revision;
  return applyRecommendationRevision({
    userId: input.userId,
    recommendationId: input.recommendationId,
    revision: {
      direction: r.direction,
      planType: r.planType,
      executionState: r.executionState,
      entry: r.entry,
      entryLow: r.entryLow,
      entryHigh: r.entryHigh,
      stopLoss: r.stopLoss,
      targets: r.targets,
      activationCondition: r.activationCondition,
      invalidationRule: r.invalidationRule,
      alternativeScenario: r.alternativeScenario,
      validityCandles: r.validityCandles,
      expiresAt: r.expiresAt,
      reason: input.reason,
      source: "trade_management",
      evidence: {
        syncedFromRevisionNo: r.revisionNo,
        ticket: input.trade.order_id,
        tradeId: input.trade.trade_id,
        previousStopLoss: input.trade.executed_stop,
        previousTakeProfit: input.trade.executed_tp,
        newStopLoss: r.stopLoss ?? null,
        newTakeProfit: r.targets[0] ?? null,
        eaCommandId: input.commandId,
      },
    },
  }).catch((error: unknown) => {
    // The broker command is already queued; a refused record (terminal race,
    // concurrent revision) must not undo it. The command queue keeps its own
    // audit trail either way.
    log.warn("trade-management sync revision refused", {
      recommendationId: input.recommendationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
}

/**
 * React to a revision that landed on a recommendation whose trade is already
 * open. Called from the re-evaluation cycle and deep-research completion —
 * the two places post-open revisions are applied.
 *
 * Does nothing loudly-nothing when: there is no open linked trade, the
 * revision changes neither the stop nor the first target, or the revision is
 * this module's own sync record (never react to yourself).
 */
export async function manageOpenTradeAfterRevision(
  input: {
    userId: number;
    /** Canonical recommendation id (the INTEGER everything joins on). */
    recommendationId: number;
    /** The revision that was just applied. */
    revision: RecommendationRevision;
  },
  deps: TradeManagementDeps = {},
): Promise<TradeManagementOutcome> {
  const { userId, recommendationId, revision } = input;
  if (revision.source === "trade_management") {
    return { action: "none", reason: "own sync revision — nothing to react to" };
  }

  const trade = await findOpenLinkedTrade(userId, recommendationId);
  if (!trade) {
    return { action: "none", reason: "no open linked trade" };
  }

  const deltas = computeDeltas(revision, trade);
  if (!deltas.stopChanged && !deltas.tpChanged) {
    return { action: "none", reason: "revision changes neither SL nor TP of the open trade" };
  }
  // The modify command needs a stop; when the revision leaves it alone, the
  // executed stop is re-sent unchanged alongside the new target.
  const stopToSend = deltas.newStop ?? trade.executed_stop;
  if (stopToSend == null || !(stopToSend > 0)) {
    return { action: "none", reason: "no usable stop-loss to send" };
  }
  const tpToSend = deltas.tpChanged ? deltas.newTp : trade.executed_tp;

  const notify = deps.notify ?? dispatchAlert;
  const changeSummary = [
    deltas.stopChanged
      ? `وقف الخسارة ${trade.executed_stop ?? "—"} → ${deltas.newStop}`
      : null,
    deltas.tpChanged ? `الهدف ${trade.executed_tp ?? "—"} → ${deltas.newTp}` : null,
  ]
    .filter(Boolean)
    .join("، ");

  // Standing authorisation applies only when the operator granted it AND the
  // rollout stage permits touching this account. Anything less is advisory.
  const autoAuthorized = await (deps.isAutoAuthorized ?? isAutoExecutionAuthorized)(userId);
  const ticket = Number(trade.order_id);
  const canReachBroker =
    trade.broker === "mt_ea" && Number.isFinite(ticket) && ticket > 0;

  if (autoAuthorized && canReachBroker && (await stagePermitsAutoModify(userId, deps))) {
    // The one modify path — the same EA command the operator's own adjust_sl
    // uses. Never a new broker call site.
    const command = await (deps.queueModify ?? queueEaModifySlTp)(
      userId,
      ticket,
      stopToSend,
      tpToSend,
    );
    const reason = `إدارة الصفقة: ${changeSummary} — مزامنة الصفقة المفتوحة مع النسخة ${revision.revisionNo} (${revision.reason}).`;
    const sync = await recordSyncRevision({
      userId,
      recommendationId,
      revision,
      trade,
      commandId: command.id,
      reason,
    });
    await notify(userId, {
      type: "signal",
      title: `تحديث صفقة ${revision.direction === "sell" ? "بيع" : "شراء"} مفتوحة`,
      text: `عُدّلت مستويات الصفقة المفتوحة (تذكرة ${ticket}) تلقائياً بموجب التفويض الدائم:\n${changeSummary}\nالسبب: ${revision.reason}`,
      symbol: null,
    }).catch(() => undefined);
    return {
      action: "auto_modified",
      reason,
      commandId: command.id,
      revisionNo: sync?.revisionNo,
    };
  }

  // Advisory: propose, never touch. One pending proposal per revision — a
  // second sweep over the same revision must not stack duplicate approvals.
  const existing = await query<{ id: number }>(
    `SELECT id FROM trade_intents
      WHERE user_id = ? AND recommendation_id = ?
        AND authorization_source = 'trade_management'
        AND recommendation_revision_no = ? AND status = 'pending'`,
    [userId, recommendationId, revision.revisionNo],
  ).catch(() => []);
  if (existing.length) {
    return {
      action: "none",
      reason: "an approval for this revision is already pending",
      intentId: existing[0]!.id,
    };
  }

  const intent = await createIntent(userId, {
    recommendation_id: recommendationId,
    recommendation_revision_no: revision.revisionNo,
    authorization_source: "trade_management",
    symbol: await recommendationSymbol(userId, recommendationId),
    side: revision.direction,
    // Not an order: nothing is sized. The executor refuses this intent anyway.
    notional: 0,
    entry: null,
    stop_loss: stopToSend,
    take_profit: tpToSend,
    rationale: `تعديل SL/TP لصفقة مفتوحة (تذكرة ${trade.order_id ?? "?"}): ${changeSummary}. السبب: ${revision.reason}`,
  });

  await appendRecommendationHistory({
    userId,
    recommendationId,
    kind: "trade_management",
    actor: "agent",
    source: revision.source,
    payload: {
      proposal: "modify_sl_tp",
      intentId: intent.id,
      revisionNo: revision.revisionNo,
      ticket: trade.order_id,
      newStopLoss: stopToSend,
      newTakeProfit: tpToSend,
    },
  }).catch(() => undefined);

  await notify(userId, {
    type: "signal",
    title: `اقتراح تعديل صفقة ${intent.symbol} المفتوحة`,
    text: `الخطة تغيّرت بعد فتح الصفقة (تذكرة ${trade.order_id ?? "?"}):\n${changeSummary}\nالسبب: ${revision.reason}\nوافق لتطبيق التعديل على الوسيط.`,
    symbol: intent.symbol,
    buttons: buildApprovalButtons(intent.id),
  }).catch(() => undefined);

  return {
    action: "approval_requested",
    reason: `أُنشئ طلب موافقة لتعديل SL/TP: ${changeSummary}.`,
    intentId: intent.id,
  };
}

/** The approval intent needs a symbol; read the recommendation's own. */
async function recommendationSymbol(
  userId: number,
  recommendationId: number,
): Promise<string> {
  const row = await queryOne<{ symbol: string }>(
    "SELECT symbol FROM recommendations WHERE id = ? AND user_id = ?",
    [recommendationId, userId],
  ).catch(() => null);
  return row?.symbol ?? "UNKNOWN";
}

/**
 * Apply a trade-management intent the operator APPROVED.
 *
 * Called from the approval flow's respond path — never directly by a monitor.
 * Re-reads the trade so an approval that arrives after the position closed
 * does nothing at the broker.
 */
export async function applyApprovedTradeManagement(
  userId: number,
  intent: TradeIntent,
  deps: TradeManagementDeps = {},
): Promise<{ ok: boolean; reason: string; commandId?: number; revisionNo?: number }> {
  if (intent.authorization_source !== "trade_management") {
    return { ok: false, reason: "ليس طلب إدارة صفقة." };
  }
  if (intent.recommendation_id == null) {
    return { ok: false, reason: "الطلب غير مرتبط بتوصية." };
  }

  const trade = await findOpenLinkedTrade(userId, intent.recommendation_id);
  if (!trade) {
    return { ok: false, reason: "الصفقة لم تعد مفتوحة — لم يُرسل أي تعديل." };
  }
  const ticket = Number(trade.order_id);
  if (trade.broker !== "mt_ea" || !Number.isFinite(ticket) || ticket <= 0) {
    return { ok: false, reason: "لا توجد تذكرة MT5 صالحة لهذه الصفقة." };
  }
  const stopLoss = intent.stop_loss;
  if (stopLoss == null || !(stopLoss > 0)) {
    return { ok: false, reason: "لا يوجد وقف خسارة صالح في الطلب." };
  }

  const command = await (deps.queueModify ?? queueEaModifySlTp)(
    userId,
    ticket,
    stopLoss,
    intent.take_profit ?? null,
  );

  // Record the approved sync in the plan's append-only history. The effective
  // revision may have moved past the proposal; the record is written against
  // whatever is in force now, with the proposal's revision noted as evidence.
  const effective = await getEffectiveRevision(userId, intent.recommendation_id);
  let revisionNo: number | undefined;
  if (effective) {
    const sync = await recordSyncRevision({
      userId,
      recommendationId: intent.recommendation_id,
      revision: effective,
      trade,
      commandId: command.id,
      reason: `إدارة الصفقة: وافق المشغّل على تعديل SL/TP (طلب ${intent.id}) — عُدّلت الصفقة المفتوحة.`,
    });
    revisionNo = sync?.revisionNo;
  }

  const notify = deps.notify ?? dispatchAlert;
  await notify(userId, {
    type: "signal",
    title: `تم تعديل صفقة ${intent.symbol}`,
    text: `أُرسل تعديل SL/TP للصفقة المفتوحة (تذكرة ${ticket}) بعد موافقتك.`,
    symbol: intent.symbol,
  }).catch(() => undefined);

  return { ok: true, reason: "أُرسل التعديل إلى الوسيط.", commandId: command.id, revisionNo };
}

/**
 * The one entry point the approval respond path needs.
 *
 * A trade-management intent is a PROPOSAL to modify an open position's SL/TP.
 * Approving it must reach the broker only through the modify path — routing it
 * into executeIntent would open a second position on top of the live one, so
 * the respond path branches here BEFORE any order machinery runs.
 */
export async function respondToTradeManagementIntent(
  userId: number,
  intent: TradeIntent,
  action: "approve" | "reject",
  deps: TradeManagementDeps = {},
): Promise<{ ok: boolean; status: string; reason?: string; commandId?: number }> {
  if (intent.authorization_source !== "trade_management") {
    return { ok: false, status: "failed", reason: "ليس طلب إدارة صفقة." };
  }
  if (action === "reject") {
    await updateIntentStatus(intent.id, "rejected", "رفضه المشغّل.");
    return { ok: true, status: "rejected" };
  }
  const outcome = await applyApprovedTradeManagement(userId, intent, deps);
  await updateIntentStatus(
    intent.id,
    outcome.ok ? "executed" : "failed",
    outcome.reason,
  );
  return {
    ok: outcome.ok,
    status: outcome.ok ? "executed" : "failed",
    reason: outcome.reason,
    commandId: outcome.commandId,
  };
}
