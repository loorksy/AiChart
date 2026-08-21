/**
 * The host's baseline runner: real work for scheduled ticks, explicit
 * placeholders for the rest.
 *
 * Scheduled ticks were the old cron's job and are fully owned here — the
 * sweep and the candle sync run under the same distributed lock the cron
 * routes used, so an externally-installed cron and the resident host can
 * coexist without double-running.
 *
 * user_message and market_event handling belong to the agent loop (Phase 3)
 * and the notifier (Phase 6). Until those wire in, this runner REFUSES them
 * with a named error rather than pretending: a silent no-op here would read
 * as "the agent ignored me".
 */
import { createLogger } from "@/lib/logger";
import type { AgentRunContext, AgentRunner } from "./host";
import type { MarketEvent, ScheduledTickEvent, UserMessageEvent } from "./events";

const log = createLogger("resident.baseline");

export class AgentLoopNotWiredError extends Error {
  constructor(kind: string) {
    super(`No handler wired for ${kind} events yet — the agent loop must be attached.`);
    this.name = "AgentLoopNotWiredError";
  }
}

const SWEEP_LOCK_MS = 290_000;
const SYNC_LOCK_MS = 570_000;

export async function runSweepTick(ctx: AgentRunContext): Promise<void> {
  const { withLock } = await import("@/lib/locks");
  const { runRecommendationSweep } = await import(
    "@/lib/recommendations/recommendationTracker"
  );
  const outcome = await withLock("cron:recommendation-sweep", SWEEP_LOCK_MS, () =>
    runRecommendationSweep({ logger: log }),
  );
  if (!outcome.ran) return;
  // The sweep can close/expire plans — the warm picture must follow.
  await ctx.warm.refreshRecommendations();

  // Proactive notifications are EVENT-driven: what this sweep observed
  // (activations, targets, invalidations) goes onto the queue as
  // market_event entries; delivery — preferences, exactly-once, channels —
  // happens in the runner, never here.
  const { publishLifecycleNotifications } = await import("./notifications");
  await publishLifecycleNotifications(
    outcome.result?.userEvents ?? [],
    ctx.publish,
  );

  // The news-block check rides the same tick: for every owner of an open
  // plan, an imminent high-impact release becomes a market_event too. With
  // no calendar provider configured this is an honest no-op.
  const { checkEconomicEventProximity } = await import(
    "@/lib/recommendations/economicEventMonitor"
  );
  const owners = [
    ...new Set(ctx.warm.get().openRecommendations.map((rec) => rec.userId)),
  ];
  for (const userId of owners) {
    const proximity = await checkEconomicEventProximity(userId).catch(() => null);
    if (proximity?.events.length) {
      await publishLifecycleNotifications(
        proximity.events.map((event) => ({ userId, event })),
        ctx.publish,
      );
    }
  }
}

export async function runCandleSyncTick(ctx: AgentRunContext): Promise<void> {
  const { withLock } = await import("@/lib/locks");
  const { syncGoldCandleStore } = await import("@/lib/gold/candleStore");
  await withLock("cron:gold-candles", SYNC_LOCK_MS, async () => {
    await syncGoldCandleStore();
  });
  // Ranges moved; reload the cheap summaries so health reports fresh truth.
  await ctx.warm.load();
}

export class BaselineRunner implements AgentRunner {
  async onScheduledTick(event: ScheduledTickEvent, ctx: AgentRunContext): Promise<void> {
    switch (event.tick) {
      case "recommendation_sweep":
        return runSweepTick(ctx);
      case "candle_sync":
        return runCandleSyncTick(ctx);
      case "restart_check":
        // Owned by the host itself; reaching here is a routing bug.
        log.warn("restart_check reached the runner");
        return;
    }
  }

  async onUserMessage(event: UserMessageEvent, _ctx: AgentRunContext): Promise<void> {
    void _ctx;
    throw new AgentLoopNotWiredError(`user_message (channel ${event.channel.type})`);
  }

  async onMarketEvent(event: MarketEvent, _ctx: AgentRunContext): Promise<void> {
    void _ctx;
    throw new AgentLoopNotWiredError(`market_event (${event.event})`);
  }
}
