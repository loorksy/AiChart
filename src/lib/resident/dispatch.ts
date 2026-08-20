/**
 * Publishing resident events from the web process.
 *
 * The webhook routes normalize inbound traffic into resident events; WHERE
 * those events run depends on the deployment:
 *
 *  - **REDIS_URL set** (production): events are XADDed to the durable stream
 *    and the resident worker process consumes them. The web process never
 *    runs the agent.
 *  - **No REDIS_URL** (dev): a lazy in-process resident host spins up inside
 *    the web process — same host, same runner, memory bus — so the full
 *    two-way channel works with nothing but `next dev`.
 *
 * The in-process host hangs off `globalThis` so dev hot-reload reuses one
 * host instead of leaking one per recompile.
 */
import { createLogger } from "@/lib/logger";
import { createEventBus, type EventBus } from "./bus";
import type { ResidentEvent } from "./events";
import { ResidentHost } from "./host";
import { ResidentAgentRunner } from "./residentAgentRunner";

const log = createLogger("resident.dispatch");

interface DispatchState {
  bus: EventBus;
  host: ResidentHost | null;
  started: Promise<void> | null;
}

const GLOBAL_KEY = Symbol.for("aichart.resident.dispatch");

function state(): DispatchState {
  const holder = globalThis as unknown as Record<symbol, DispatchState | undefined>;
  let current = holder[GLOBAL_KEY];
  if (!current) {
    const redis = Boolean(process.env.REDIS_URL?.trim());
    const bus = createEventBus();
    current = {
      bus,
      // Redis mode: publish-only — the worker owns consumption. Memory mode:
      // this process must also HOST the agent or events would go nowhere.
      host: redis
        ? null
        : new ResidentHost({
            bus,
            runner: new ResidentAgentRunner(),
            healthPort: null,
            // Ticks belong to the worker even in dev; the web-process host
            // only answers channel traffic.
            sweepEveryMs: 0,
            candleSyncEveryMs: 0,
            maxUptimeMs: 0,
          }),
      started: null,
    };
    holder[GLOBAL_KEY] = current;
  }
  return current;
}

async function ensureStarted(current: DispatchState): Promise<void> {
  if (!current.host) return;
  if (!current.started) {
    current.started = (async () => {
      const { registerAllChannelSenders } = await import("@/lib/channels/registry");
      registerAllChannelSenders(current.host!);
      await current.host!.start();
      log.info("in-process resident host started (no REDIS_URL)");
    })();
  }
  await current.started;
}

/**
 * Publish one resident event from the web process. Returns after the event
 * is durably enqueued (Redis) or accepted by the in-process host (memory);
 * the agent's reply is delivered through the channel sender, not returned.
 */
export async function publishResidentEvent(event: ResidentEvent): Promise<void> {
  const current = state();
  await ensureStarted(current);
  await current.bus.publish(event);
}

/** Test seam: drop the module-level dispatch state. */
export async function resetResidentDispatch(): Promise<void> {
  const holder = globalThis as unknown as Record<symbol, DispatchState | undefined>;
  const current = holder[GLOBAL_KEY];
  holder[GLOBAL_KEY] = undefined;
  if (current?.host) await current.host.shutdown("reset").catch(() => {});
}
