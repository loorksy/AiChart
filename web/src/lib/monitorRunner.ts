import { resolveScanAssetsForMarket } from "./allowedAssets.server";
import { buildAccountProfile } from "./accountProfile";
import { wakeAgentViaTelegram } from "./agentWake";
import { isAgentWakeEnabled } from "./agentWakeConfig";
import { runCronPostScan } from "./cronPostScan";
import {
  getEaConnection,
  isHeartbeatFresh,
  parseEaSymbolSpecs,
} from "./eaStore";
import { forexCanonicalKey, resolveMt5Symbol } from "./mt5SymbolMap";
import {
  scanForexSymbol,
  scanSymbol,
  type OpportunityCandidate,
} from "./monitor";
import {
  collectTradeWatchAlerts,
  watchDailyLossProximity,
} from "./tradeWatch";
import {
  isOnCooldown,
  listUsersForMonitor,
  touchScanCooldown,
} from "./store";
import type { MarketType } from "./markets/types";
import type { TradingSettings } from "./types";

export interface MonitorCycleEvent {
  userId: number;
  type: "market_candidate" | "trade_alert" | "daily_loss_warn";
  detail: string;
  woke: boolean;
}

export interface MonitorCycleResult {
  users: number;
  maintenance: Awaited<ReturnType<typeof runCronPostScan>>;
  events: MonitorCycleEvent[];
  errors: string[];
}

async function forexScanReady(
  userId: number,
  symbol: string,
): Promise<{ ok: boolean; reason?: string }> {
  const conn = await getEaConnection(userId);
  if (!conn) return { ok: false, reason: "لا ربط EA" };
  if (!isHeartbeatFresh(conn.last_heartbeat_at)) {
    return { ok: false, reason: "EA offline" };
  }
  const resolved = (await resolveMt5Symbol(userId, symbol)) ?? symbol;
  const canonical = forexCanonicalKey(symbol);
  const spec = parseEaSymbolSpecs(conn.symbol_specs_json).find(
    (s) =>
      s.symbol?.toUpperCase() === resolved.toUpperCase() ||
      forexCanonicalKey(s.symbol ?? "") === canonical,
  );
  if (!spec) return { ok: false, reason: `الرمز ${symbol} غير في heartbeat` };
  const bid = Number(spec.bid) || 0;
  const ask = Number(spec.ask) || 0;
  if (bid <= 0 || ask <= 0) return { ok: false, reason: "لا quotes" };
  return { ok: true };
}

async function scanMarketForUser(
  userId: number,
  settings: TradingSettings,
): Promise<OpportunityCandidate | null> {
  const market: MarketType = settings.active_market ?? "crypto";
  const interval = settings.analysis_interval ?? "1h";
  const symbols = await resolveScanAssetsForMarket(
    settings.allowed_assets,
    market,
    settings.user_id,
    40,
  );

  let best: OpportunityCandidate | null = null;
  for (const symbol of symbols) {
    if (await isOnCooldown(userId, symbol)) continue;
    try {
      const candidate =
        market === "forex"
          ? await scanForexSymbol(userId, symbol, settings.style, interval)
          : await scanSymbol(symbol, settings.style, interval);
      if (!candidate) continue;
      if (!best || candidate.score > best.score) best = candidate;
    } catch {
      /* skip symbol */
    }
  }
  return best;
}

function candidateDetail(c: OpportunityCandidate, market: MarketType): string {
  return [
    `السوق: ${market}`,
    `الرمز: ${c.symbol} · ${c.interval}`,
    `النقاط: ${c.score}`,
    `إشارات: ${c.signals.join("، ")}`,
    c.snapshot.summary,
  ].join("\n");
}

/**
 * Event-driven monitor — mechanical maintenance always; agent wakes only when
 * AGENT_WAKE_ENABLED=1 (legacy). MCP conversational mode skips wakes.
 */
export async function runMonitorCycle(): Promise<MonitorCycleResult> {
  const result: MonitorCycleResult = {
    users: 0,
    maintenance: await runCronPostScan(),
    events: [],
    errors: [],
  };

  if (!isAgentWakeEnabled()) {
    return result;
  }

  const users = await listUsersForMonitor();
  result.users = users.length;

  for (const { id: userId, settings } of users) {
    try {
      const tradeAlerts = await collectTradeWatchAlerts(userId);
      if (tradeAlerts.length > 0) {
        const profile = await buildAccountProfile(userId);
        const envLine = `المنصة: ${profile.platform} · الحساب: ${profile.accountLogin ?? "—"} · ${profile.accountType}`;
        const detail = [
          envLine,
          profile.hasLeverage && profile.leverage
            ? `الرافعة: ${profile.leverage}x`
            : null,
          profile.hasSpread && profile.spreadPips != null
            ? `السبريد: ${profile.spreadPips} نقطة`
            : null,
          ...tradeAlerts.map((a) => a.detail),
        ]
          .filter(Boolean)
          .join("\n");
        const woke = await wakeAgentViaTelegram(userId, {
          event: "trade_alert",
          detail,
          dedupeMinutes: 20,
        });
        result.events.push({
          userId,
          type: "trade_alert",
          detail,
          woke,
        });
      }

      const lossWarn = await watchDailyLossProximity(userId, settings);
      if (lossWarn) {
        const woke = await wakeAgentViaTelegram(userId, {
          event: "daily_loss_warn",
          detail: lossWarn,
          dedupeMinutes: 60,
        });
        result.events.push({
          userId,
          type: "daily_loss_warn",
          detail: lossWarn,
          woke,
        });
      }

      const candidate = await scanMarketForUser(userId, settings);
      if (!candidate) continue;

      const market = settings.active_market ?? "crypto";
      if (market === "forex") {
        const ready = await forexScanReady(userId, candidate.symbol);
        if (!ready.ok) continue;
      }

      await touchScanCooldown(userId, candidate.symbol);
      const detail = candidateDetail(candidate, market);
      const woke = await wakeAgentViaTelegram(userId, {
        event: "market_candidate",
        detail,
        dedupeMinutes: 240,
      });
      result.events.push({
        userId,
        type: "market_candidate",
        detail,
        woke,
      });
    } catch (e) {
      result.errors.push(
        `user ${userId}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }

  return result;
}
