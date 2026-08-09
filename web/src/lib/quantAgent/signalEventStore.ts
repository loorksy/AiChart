/**
 * Persistent SIGNAL HISTORY for AI Scheduled Monitors — the append-only log of
 * every fire, with what fired, why it fired, and what happened on each
 * notification channel.
 *
 * Before this store, a fired monitor produced a Telegram message and one
 * overwritten column (`quant_agent_monitors.last_fired_recommendation_id`).
 * Nothing was queryable, nothing was visible in-product, and a Telegram send
 * that failed left no trace whatsoever. This is the table that fixes that, and
 * the two properties that make it worth having are:
 *
 *  1. **The row is claimed BEFORE delivery.** `claimSignalEvent` inserts first
 *     and only then does the caller fan out. A failed send therefore still
 *     leaves a queryable record with `delivery.telegram.status === "failed"`,
 *     which is the whole point — the log has to be able to say "we tried and it
 *     did not go out", not fall silent exactly when something went wrong.
 *  2. **The claim IS the delivery lock.** The unique index
 *     `(monitor_id, bar_time, decision)` means a second sweep inside the same
 *     bar inserts nothing, `claimSignalEvent` returns null, and the caller
 *     skips delivery entirely. One row, one delivery. A real decision change
 *     inside the same bar (HOLD -> SELL) is a different tuple and does fire.
 *
 * Ported from QuantDinger (https://github.com/OpenByteInc/QuantDinger),
 * Copyright Open Byte Inc., licensed under the Apache License, Version 2.0
 * — `backend_api_python/app/services/indicator_signal_alerts.py`
 * (`_signal_fingerprint`, `_mark_triggered`, the `{channel: {ok, message}}`
 * delivery map persisted into `last_signal_payload`).
 *
 * What changed, and why: upstream has NO fired-signal table at all. It keeps
 * exactly one fire per alert in `last_signal_payload`, computes a SHA-1
 * fingerprint solely to compare against the single previous one, and its
 * closest thing to a history is `qd_strategy_notifications`, which only
 * receives a row when the alert happens to include the `browser` channel — so
 * a Telegram-only alert is unrecorded by construction. Upstream's own port
 * notes recommend the table built here. The fingerprint becomes a real UNIQUE
 * constraint over spelled-out columns rather than an opaque hash, so the
 * constraint is readable in the schema and the bar it locks is renderable in
 * the UI.
 *
 * Own file under `lib/quantAgent/` — NOT `lib/store.ts` (Lonora-scoped) — the
 * same isolation principle as `monitorStore.ts` and `analysisStore.ts`. It
 * writes only to `quant_agent_signal_events` and never to `recommendations`.
 */
import { randomUUID } from "node:crypto";
import { execute, query, queryOne } from "@/lib/db";
import { barDurationMs } from "@/lib/intervals";

/** BUY/SELL/HOLD, the same vocabulary the analysis engine speaks. */
export type SignalDecision = "BUY" | "SELL" | "HOLD";

/** Which notification channels a monitor fire can reach. No email: no SMTP. */
export const SIGNAL_CHANNELS = ["telegram", "push", "webhook"] as const;
export type SignalChannel = (typeof SIGNAL_CHANNELS)[number];

/**
 * `skipped` is a first-class outcome, not a synonym for failure: the channel
 * was switched off on this monitor, so nothing was attempted and nothing went
 * wrong. Collapsing it into `failed` would make the history page accuse the
 * platform of losing messages it was never asked to send.
 */
export type SignalDeliveryStatus = "delivered" | "failed" | "skipped";

export interface SignalChannelDelivery {
  status: SignalDeliveryStatus;
  /** Present only on `failed`. Free text from the transport, never a URL. */
  error?: string | null;
}

export type SignalDeliveryReport = Record<SignalChannel, SignalChannelDelivery>;

/** Every channel starts as "not attempted"; the caller overwrites what it tries. */
export function emptySignalDeliveryReport(): SignalDeliveryReport {
  return {
    telegram: { status: "skipped" },
    push: { status: "skipped" },
    webhook: { status: "skipped" },
  };
}

export interface SignalEventRecord {
  id: string;
  /** null once the monitor has been deleted — the fire still happened. */
  monitorId: number | null;
  symbol: string;
  market: string;
  interval: string;
  decision: SignalDecision;
  direction: "buy" | "sell" | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  confidence: number | null;
  rationale: string | null;
  /** Which firing rule let this through. */
  fireRule: string;
  /** What the monitor had last fired, if anything — the `on_change` evidence. */
  previousDecision: string | null;
  recommendationId: string | null;
  /** Start of the bar this fire belongs to, epoch ms. Part of the dedupe key. */
  barTime: number;
  delivery: SignalDeliveryReport;
  /** True when at least one channel actually delivered. */
  delivered: boolean;
  createdAt: string;
}

interface SignalEventDbRow {
  id: string;
  user_id: number;
  monitor_id: number | null;
  symbol: string;
  market: string;
  interval: string;
  decision: string;
  direction: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  confidence: number | null;
  rationale: string | null;
  fire_rule: string;
  previous_decision: string | null;
  recommendation_id: string | null;
  bar_time: number;
  delivery_json: string | null;
  delivered: number;
  created_at: number;
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeChannelDelivery(raw: unknown): SignalChannelDelivery {
  if (!raw || typeof raw !== "object") return { status: "skipped" };
  const value = raw as { status?: unknown; error?: unknown };
  const status =
    value.status === "delivered" || value.status === "failed" ? value.status : "skipped";
  const error = typeof value.error === "string" && value.error ? value.error : null;
  return status === "failed" ? { status, error } : { status };
}

function parseDelivery(raw: string | null): SignalDeliveryReport {
  const report = emptySignalDeliveryReport();
  if (!raw) return report;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A row written by an older shape is still worth showing; the caller gets
    // "not attempted" per channel rather than an invented success.
    return report;
  }
  if (!parsed || typeof parsed !== "object") return report;
  for (const channel of SIGNAL_CHANNELS) {
    report[channel] = normalizeChannelDelivery((parsed as Record<string, unknown>)[channel]);
  }
  return report;
}

function toDecision(raw: string): SignalDecision {
  return raw === "BUY" || raw === "SELL" ? raw : "HOLD";
}

function toRecord(row: SignalEventDbRow): SignalEventRecord {
  const direction = row.direction === "buy" || row.direction === "sell" ? row.direction : null;
  return {
    id: row.id,
    monitorId: row.monitor_id == null ? null : Number(row.monitor_id),
    symbol: row.symbol,
    market: row.market,
    interval: row.interval,
    decision: toDecision(row.decision),
    direction,
    entryPrice: numberOrNull(row.entry_price),
    stopLoss: numberOrNull(row.stop_loss),
    takeProfit: numberOrNull(row.take_profit),
    confidence: numberOrNull(row.confidence),
    rationale: row.rationale,
    fireRule: row.fire_rule,
    previousDecision: row.previous_decision,
    recommendationId: row.recommendation_id,
    barTime: Number(row.bar_time),
    delivery: parseDelivery(row.delivery_json),
    delivered: Number(row.delivered) === 1,
    createdAt: new Date(Number(row.created_at)).toISOString(),
  };
}

/**
 * The bar a timestamp falls in, as epoch ms of the bar's opening edge.
 *
 * This is the "within one bar" in "the same condition firing twice within one
 * bar delivers once". It is derived from the monitor's own interval rather
 * than from the recommendation id: the id already dedupes an UNCHANGED
 * recommendation, but a re-run that produces a fresh id for the same still-open
 * candle would slip past it, and a user watching a 4h monitor does not want
 * four identical alerts because the sweep ran four times inside one candle.
 */
export function barBucketStart(interval: string, at: number = Date.now()): number {
  const size = barDurationMs(interval);
  if (!Number.isFinite(size) || size <= 0) return Math.trunc(at);
  return Math.floor(at / size) * size;
}

export interface ClaimSignalEventInput {
  monitorId: number;
  symbol: string;
  market?: string;
  interval: string;
  decision: SignalDecision;
  direction?: "buy" | "sell" | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  confidence?: number | null;
  rationale?: string | null;
  fireRule: string;
  previousDecision?: string | null;
  recommendationId?: string | null;
  /** Defaults to the bar `firedAt` falls in for this interval. */
  barTime?: number;
  firedAt?: number;
}

/**
 * The claim outcome, as a discriminated union rather than "row or null".
 *
 * The distinction matters at the call site: `duplicate` is the ONE reason a
 * caller may skip delivering. Anything else that goes wrong (the store throws)
 * must fall through and deliver unrecorded, because a bookkeeping failure is
 * not allowed to become a new way for a real alert to go missing.
 */
export type ClaimSignalEventResult =
  | { claimed: true; event: SignalEventRecord }
  | { claimed: false; reason: "duplicate" };

/**
 * Claims the right to deliver one fire, and records it.
 *
 * The insert IS the lock: `ON CONFLICT DO NOTHING` against the unique
 * `(monitor_id, bar_time, decision)` index makes the claim atomic on both
 * backends, so two overlapping cron ticks cannot both decide they are first.
 *
 * Delivery results are written afterwards by `recordSignalEventDelivery`. The
 * row exists in between with every channel marked `skipped`, which is the
 * accurate description of a fire whose delivery has not been attempted yet.
 */
export async function claimSignalEvent(
  userId: number,
  input: ClaimSignalEventInput,
): Promise<ClaimSignalEventResult> {
  const id = randomUUID();
  const firedAt = input.firedAt ?? Date.now();
  const barTime = input.barTime ?? barBucketStart(input.interval, firedAt);
  const market = input.market?.trim() || "forex";
  const delivery = emptySignalDeliveryReport();

  const res = await execute(
    `INSERT INTO quant_agent_signal_events
       (id, user_id, monitor_id, symbol, market, interval, decision, direction,
        entry_price, stop_loss, take_profit, confidence, rationale, fire_rule,
        previous_decision, recommendation_id, bar_time, delivery_json, delivered, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT (monitor_id, bar_time, decision) DO NOTHING`,
    [
      id,
      userId,
      input.monitorId,
      input.symbol,
      market,
      input.interval,
      input.decision,
      input.direction ?? null,
      input.entryPrice ?? null,
      input.stopLoss ?? null,
      input.takeProfit ?? null,
      input.confidence ?? null,
      input.rationale ?? null,
      input.fireRule,
      input.previousDecision ?? null,
      input.recommendationId ?? null,
      barTime,
      JSON.stringify(delivery),
      firedAt,
    ],
  );
  if (res.changes < 1) return { claimed: false, reason: "duplicate" };

  // Built from the input rather than read back: every field was just written
  // from these values, and a read-back would add a round trip whose only
  // failure mode is a `null` the caller would have to invent a meaning for.
  return {
    claimed: true,
    event: {
      id,
      monitorId: input.monitorId,
      symbol: input.symbol,
      market,
      interval: input.interval,
      decision: input.decision,
      direction: input.direction ?? null,
      entryPrice: input.entryPrice ?? null,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      confidence: input.confidence ?? null,
      rationale: input.rationale ?? null,
      fireRule: input.fireRule,
      previousDecision: input.previousDecision ?? null,
      recommendationId: input.recommendationId ?? null,
      barTime,
      delivery,
      delivered: false,
      createdAt: new Date(firedAt).toISOString(),
    },
  };
}

/**
 * Writes the per-channel outcome onto an already-claimed event.
 *
 * `delivered` is derived here rather than taken from the caller so the scalar
 * and the JSON can never disagree: it is 1 exactly when some channel reports
 * `delivered`.
 */
export async function recordSignalEventDelivery(
  id: string,
  delivery: SignalDeliveryReport,
): Promise<void> {
  const delivered = SIGNAL_CHANNELS.some((channel) => delivery[channel]?.status === "delivered");
  await execute(
    "UPDATE quant_agent_signal_events SET delivery_json = ?, delivered = ? WHERE id = ?",
    [JSON.stringify(delivery), delivered ? 1 : 0, id],
  );
}

export const SIGNAL_EVENT_LIST_DEFAULT_LIMIT = 20;
export const SIGNAL_EVENT_LIST_MAX_LIMIT = 100;

export interface ListSignalEventsOptions {
  limit?: number;
  /** Opaque keyset cursor from a previous page — `"<createdAt>|<id>"`. */
  cursor?: string | null;
  symbol?: string | null;
  monitorId?: number | null;
  decision?: SignalDecision | null;
}

export interface ListSignalEventsResult {
  items: SignalEventRecord[];
  nextCursor: string | null;
}

function encodeCursor(row: SignalEventDbRow): string {
  return `${Number(row.created_at)}|${row.id}`;
}

function decodeCursor(cursor: string): { createdAt: number; id: string } | null {
  const separator = cursor.indexOf("|");
  if (separator <= 0) return null;
  const createdAt = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (!Number.isFinite(createdAt) || !id) return null;
  return { createdAt, id };
}

/**
 * The caller's own signal history, newest first, keyset-paginated.
 *
 * Keyset rather than OFFSET for the same reason `analysisStore` uses it: the
 * list is appended to by a cron while a user pages back through it, and OFFSET
 * duplicates or skips a row every time a new one lands at the head.
 */
export async function listSignalEvents(
  userId: number,
  options: ListSignalEventsOptions = {},
): Promise<ListSignalEventsResult> {
  const limit = Math.min(
    Math.max(1, Math.trunc(options.limit ?? SIGNAL_EVENT_LIST_DEFAULT_LIMIT)),
    SIGNAL_EVENT_LIST_MAX_LIMIT,
  );

  const where: string[] = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.symbol) {
    where.push("symbol = ?");
    params.push(options.symbol);
  }
  if (options.monitorId != null) {
    where.push("monitor_id = ?");
    params.push(options.monitorId);
  }
  if (options.decision) {
    where.push("decision = ?");
    params.push(options.decision);
  }
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (cursor) {
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  // One extra row purely to learn whether another page exists, then dropped.
  params.push(limit + 1);

  const rows = await query<SignalEventDbRow>(
    `SELECT * FROM quant_agent_signal_events
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(toRecord),
    nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/**
 * One signal event the caller owns, or null.
 *
 * Ownership is filtered in SQL AND re-asserted on the returned row — the same
 * belt-and-braces `analysisStore.getQuantAnalysis` uses, for the same reason:
 * a by-id read whose only protection is a clause someone can later "simplify"
 * out is an authz hole waiting to happen.
 */
export async function getSignalEvent(
  userId: number,
  id: string,
): Promise<SignalEventRecord | null> {
  const row = await queryOne<SignalEventDbRow>(
    "SELECT * FROM quant_agent_signal_events WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  if (!row) return null;
  if (Number(row.user_id) !== userId) return null;
  return toRecord(row);
}
