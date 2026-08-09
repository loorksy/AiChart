/**
 * "AI Scheduled Monitors" store for Quant Agent Chat's right rail (plan
 * "Feature A — Watchlist + AI Scheduled Monitors" §A2). Own file under
 * `lib/quantAgent/` — NOT added to `lib/store.ts` (Lonora-scoped) — same
 * isolation principle as `chatStore.ts` and `watchlistStore.ts`.
 *
 * Backend-agnostic: unified db layer with `?` placeholders. Per-user CRUD is
 * scoped by userId; `listEnabledMonitorsGroupedBySymbolInterval` is the one
 * exception — it is the cron sweep's own query and deliberately spans every
 * user's enabled monitors so one (symbol, market, interval) group only ever
 * costs one candle fetch + one quant-agent recommendation call, however many
 * users are watching it.
 */
import { execute, query, queryOne } from "@/lib/db";
import { normalizeInterval } from "@/lib/intervals";
import { normalizeWatchlistSymbol } from "./watchlistStore";

/**
 * How often a monitor is allowed to speak.
 *
 * - `always` — notify whenever the sweep finds a signal. Upstream's only
 *   behaviour, and the default, so no existing monitor changes meaning.
 * - `on_change` — notify only when the decision DIFFERS from the last one that
 *   fired. HOLD -> SELL fires; SELL -> SELL does not. This is what a user
 *   watching a slow timeframe actually wants: the second identical SELL is not
 *   news, it is the same news again.
 */
export const MONITOR_FIRE_RULES = ["always", "on_change"] as const;
export type MonitorFireRule = (typeof MONITOR_FIRE_RULES)[number];

export function normalizeFireRule(value: string | null | undefined): MonitorFireRule {
  return value === "on_change" ? "on_change" : "always";
}

/**
 * The firing decision itself, pure so it is testable without a database.
 *
 * `lastDecision == null` means nothing has ever fired on this monitor, which
 * must fire under BOTH rules — an `on_change` monitor that stayed silent
 * forever because it had no previous decision to differ from would be a
 * monitor that never works.
 */
export function shouldFireForDecision(
  rule: MonitorFireRule,
  lastDecision: string | null,
  decision: string,
): boolean {
  if (rule !== "on_change") return true;
  if (lastDecision == null || lastDecision === "") return true;
  return lastDecision !== decision;
}

export interface MonitorRow {
  id: number;
  userId: number;
  symbol: string;
  market: string;
  interval: string;
  notifyTelegram: boolean;
  notifyPush: boolean;
  notifyWebhookUrl: string | null;
  enabled: boolean;
  fireRule: MonitorFireRule;
  lastFiredRecommendationId: string | null;
  /** The decision that last actually fired — null until one has. */
  lastFiredDecision: string | null;
  lastCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface MonitorDbRow {
  id: number;
  user_id: number;
  symbol: string;
  market: string;
  interval: string;
  notify_telegram: number;
  notify_push: number;
  notify_webhook_url: string | null;
  enabled: number;
  fire_rule: string | null;
  last_fired_recommendation_id: string | null;
  last_fired_decision: string | null;
  last_checked_at: number | null;
  created_at: number;
  updated_at: number;
}

function toMonitor(row: MonitorDbRow): MonitorRow {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    symbol: row.symbol,
    market: row.market,
    interval: row.interval,
    notifyTelegram: Number(row.notify_telegram) === 1,
    notifyPush: Number(row.notify_push) === 1,
    notifyWebhookUrl: row.notify_webhook_url,
    enabled: Number(row.enabled) === 1,
    fireRule: normalizeFireRule(row.fire_rule),
    lastFiredRecommendationId: row.last_fired_recommendation_id,
    lastFiredDecision: row.last_fired_decision,
    lastCheckedAt: row.last_checked_at == null ? null : Number(row.last_checked_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** Lists a user's monitors, most recently created first. */
export async function listMonitors(userId: number): Promise<MonitorRow[]> {
  const rows = await query<MonitorDbRow>(
    "SELECT * FROM quant_agent_monitors WHERE user_id = ? ORDER BY created_at DESC",
    [userId],
  );
  return rows.map(toMonitor);
}

/** Reads one monitor the user owns, or null. */
export async function getMonitor(userId: number, id: number): Promise<MonitorRow | null> {
  const row = await queryOne<MonitorDbRow>(
    "SELECT * FROM quant_agent_monitors WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return row ? toMonitor(row) : null;
}

export interface CreateMonitorInput {
  symbol: string;
  market?: string;
  interval: string;
  notifyTelegram?: boolean;
  notifyPush?: boolean;
  notifyWebhookUrl?: string | null;
  fireRule?: MonitorFireRule;
}

/** Creates a new monitor row, enabled by default. */
export async function createMonitor(
  userId: number,
  input: CreateMonitorInput,
): Promise<MonitorRow> {
  const symbol = normalizeWatchlistSymbol(input.symbol);
  if (!symbol) throw new Error("رمز غير صالح.");
  const market = input.market?.trim() || "forex";
  const interval = normalizeInterval(input.interval);
  const notifyTelegram = input.notifyTelegram ?? true;
  const notifyPush = input.notifyPush ?? false;
  const fireRule = normalizeFireRule(input.fireRule);
  const now = Date.now();

  await execute(
    `INSERT INTO quant_agent_monitors
       (user_id, symbol, market, interval, notify_telegram, notify_push, notify_webhook_url, enabled, fire_rule, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      userId,
      symbol,
      market,
      interval,
      notifyTelegram ? 1 : 0,
      notifyPush ? 1 : 0,
      input.notifyWebhookUrl ?? null,
      fireRule,
      now,
      now,
    ],
  );

  const row = await queryOne<MonitorDbRow>(
    `SELECT * FROM quant_agent_monitors
      WHERE user_id = ? AND symbol = ? AND market = ? AND interval = ?
      ORDER BY id DESC LIMIT 1`,
    [userId, symbol, market, interval],
  );
  return toMonitor(row!);
}

export interface UpdateMonitorInput {
  interval?: string;
  notifyTelegram?: boolean;
  notifyPush?: boolean;
  notifyWebhookUrl?: string | null;
  enabled?: boolean;
  fireRule?: MonitorFireRule;
}

/** Partially updates a monitor the user owns. Returns null if it isn't theirs. */
export async function updateMonitor(
  userId: number,
  id: number,
  patch: UpdateMonitorInput,
): Promise<MonitorRow | null> {
  const existing = await getMonitor(userId, id);
  if (!existing) return null;

  const fields: string[] = [];
  const params: unknown[] = [];
  if (patch.interval !== undefined) {
    fields.push("interval = ?");
    params.push(normalizeInterval(patch.interval));
  }
  if (patch.notifyTelegram !== undefined) {
    fields.push("notify_telegram = ?");
    params.push(patch.notifyTelegram ? 1 : 0);
  }
  if (patch.notifyPush !== undefined) {
    fields.push("notify_push = ?");
    params.push(patch.notifyPush ? 1 : 0);
  }
  if (patch.notifyWebhookUrl !== undefined) {
    fields.push("notify_webhook_url = ?");
    params.push(patch.notifyWebhookUrl);
  }
  if (patch.enabled !== undefined) {
    fields.push("enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.fireRule !== undefined) {
    fields.push("fire_rule = ?");
    params.push(normalizeFireRule(patch.fireRule));
  }
  if (!fields.length) return existing;

  fields.push("updated_at = ?");
  params.push(Date.now());
  params.push(id, userId);

  await execute(
    `UPDATE quant_agent_monitors SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
    params,
  );
  return getMonitor(userId, id);
}

/** Deletes a monitor the user owns. Returns false if it wasn't theirs. */
export async function deleteMonitor(userId: number, id: number): Promise<boolean> {
  const res = await execute(
    "DELETE FROM quant_agent_monitors WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return res.changes > 0;
}

export interface MonitorGroup {
  symbol: string;
  market: string;
  interval: string;
  monitors: MonitorRow[];
}

/**
 * Flat query across EVERY user's enabled monitors, then grouped in JS by
 * `${symbol}|${market}|${interval}` — avoids GROUP BY dialect differences
 * between SQLite/Postgres (plan §A2) and is what lets the cron sweep fetch
 * candles + generate one recommendation per group, no matter how many users
 * are watching that combination.
 */
export async function listEnabledMonitorsGroupedBySymbolInterval(): Promise<MonitorGroup[]> {
  const rows = await query<MonitorDbRow>(
    "SELECT * FROM quant_agent_monitors WHERE enabled = 1 ORDER BY id ASC",
  );
  const groups = new Map<string, MonitorGroup>();
  for (const row of rows) {
    const monitor = toMonitor(row);
    const key = `${monitor.symbol}|${monitor.market}|${monitor.interval}`;
    let group = groups.get(key);
    if (!group) {
      group = { symbol: monitor.symbol, market: monitor.market, interval: monitor.interval, monitors: [] };
      groups.set(key, group);
    }
    group.monitors.push(monitor);
  }
  return Array.from(groups.values());
}

/** Records that a monitor just fired a notification for `recommendationId`. */
export async function markMonitorFired(
  id: number,
  recommendationId: string,
  checkedAt: number = Date.now(),
): Promise<void> {
  await execute(
    `UPDATE quant_agent_monitors
        SET last_fired_recommendation_id = ?, last_checked_at = ?, updated_at = ?
      WHERE id = ?`,
    [recommendationId, checkedAt, checkedAt, id],
  );
}

/**
 * Records the DECISION a monitor just fired on — the state the `on_change`
 * rule compares against next time.
 *
 * Separate from `markMonitorFired` (which records the recommendation id) on
 * purpose: the recommendation id is written by the cron sweep after it decides
 * a monitor fired, while the decision is written by the notification path,
 * which is the only place that knows the fire actually cleared the rule and
 * the per-bar delivery lock. Writing it from the sweep would advance
 * `last_fired_decision` for fires that were deduplicated away, and the next
 * genuine change would then be swallowed.
 */
export async function markMonitorDecisionFired(
  id: number,
  decision: string,
  firedAt: number = Date.now(),
): Promise<void> {
  await execute(
    "UPDATE quant_agent_monitors SET last_fired_decision = ?, updated_at = ? WHERE id = ?",
    [decision, firedAt, id],
  );
}

/** Records that a monitor was checked this tick without firing (not due, or no new signal). */
export async function touchMonitorChecked(
  id: number,
  checkedAt: number = Date.now(),
): Promise<void> {
  await execute(
    "UPDATE quant_agent_monitors SET last_checked_at = ?, updated_at = ? WHERE id = ?",
    [checkedAt, checkedAt, id],
  );
}
