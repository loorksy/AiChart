import { runAgent } from "./agent";
import {
  getTodayUsage,
  incrementUsage,
  isMasterKillOn,
  isOnCooldown,
  listUsersForMonitor,
  logAudit,
  touchScanCooldown,
} from "./store";
import { resolveMonitorAssets } from "./allowedAssets";
import { scanSymbol } from "./monitor";
import { processRecommendations } from "./tradeFlow";
import { isAnthropicConfigured } from "./anthropic";
import { notifyUser } from "./telegram";

export interface MonitorCycleResult {
  usersScanned: number;
  candidatesFound: number;
  agentCalls: number;
  errors: string[];
}

/**
 * One 24/7 monitoring cycle: cheap code scans every active user's assets,
 * then invokes Claude only when a candidate opportunity appears.
 */
export async function runMonitorCycle(): Promise<MonitorCycleResult> {
  const result: MonitorCycleResult = {
    usersScanned: 0,
    candidatesFound: 0,
    agentCalls: 0,
    errors: [],
  };

  if (!isAnthropicConfigured() || (await isMasterKillOn())) return result;

  const users = await listUsersForMonitor();
  result.usersScanned = users.length;

  for (const { id: userId, settings, limits } of users) {
    const assets = await resolveMonitorAssets(settings.allowed_assets);
    if (!assets.length) continue;

    for (const symbol of assets) {
      if (await isOnCooldown(userId, symbol)) continue;

      try {
        const candidate = await scanSymbol(symbol, settings.style);
        if (!candidate) continue;

        result.candidatesFound++;
        await touchScanCooldown(userId, symbol);

        const used = await getTodayUsage(userId);
        if (limits.claude_quota > 0 && used >= limits.claude_quota) continue;

        const prompt =
          `راجع الرمز ${symbol} على إطار ${candidate.interval}. ` +
          `ظهرت إشارات فنية: ${candidate.signals.join("، ")}. ` +
          `البيانات: ${candidate.snapshot.summary}. ` +
          `هل توجد فرصة حقيقية الآن؟ سجّل توصية منظّمة أو انتظر.`;

        const agentResult = await runAgent(
          { userId, settings },
          [{ role: "user", content: prompt }],
        );
        await incrementUsage(userId, 1);
        result.agentCalls++;

        await logAudit(
          userId,
          "monitor_agent",
          `${symbol}: ${candidate.signals.join(", ")}`,
        );

        if (agentResult.recommendations.length) {
          // The monitor scans Binance crypto symbols, so executions stay crypto.
          await processRecommendations(userId, agentResult.recommendations, {
            market: "crypto",
          });

          const actionable = agentResult.recommendations.filter(
            (r) => r.action === "buy" || r.action === "sell",
          );
          if (actionable.length) {
            await notifyUser(
              userId,
              `🔔 <b>فرصة مرصودة · Opportunity detected</b>\n` +
                `${symbol}: ${actionable[0].action.toUpperCase()} (${actionable[0].confidence}%)\n` +
                `${actionable[0].rationale ?? ""}`,
            );
          }
        }
      } catch (e) {
        result.errors.push(
          `user ${userId}/${symbol}: ${e instanceof Error ? e.message : "error"}`,
        );
      }
    }
  }

  return result;
}
