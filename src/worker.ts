/**
 * The resident agent process (pm2 app `aichart-worker` / `npm run worker`).
 *
 * No longer a cron executor: one long-lived host boots, loads warm state
 * once, and then wakes on events from the unified queue — user messages,
 * scheduled ticks, market events. The legacy BullMQ job worker (embeddings,
 * post-mortems) runs inside the same process so the system stays ONE
 * resident process.
 *
 * Requires REDIS_URL for the durable stream; without it the bus runs
 * in-memory (dev only — events do not survive a restart).
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { registerAllChannelSenders } from "./lib/channels/registry";
import { initDb } from "./lib/db";
import { createLogger } from "./lib/logger";
import { shutdownQueue, startWorker } from "./lib/queue";
import { createEventBus } from "./lib/resident/bus";
import { ResidentHost } from "./lib/resident/host";
import { ResidentAgentRunner } from "./lib/resident/residentAgentRunner";

const log = createLogger("worker");

async function main(): Promise<void> {
  await initDb();

  const host = new ResidentHost({
    bus: createEventBus(),
    runner: new ResidentAgentRunner(),
    concurrency: Number(process.env.RESIDENT_CONCURRENCY || 8),
    healthPort: Number(process.env.RESIDENT_HEALTH_PORT || 8791),
    maxUptimeMs: Number(process.env.RESIDENT_MAX_UPTIME_MS || 24 * 60 * 60 * 1000),
  });
  // Outbound channels (Telegram today): how user_message events queued by
  // the web process get their replies delivered from this process.
  registerAllChannelSenders(host);
  await host.start();

  // Legacy job tier (embeddings, post-mortems) — same process, same lifetime.
  await startWorker();

  log.info("resident agent process ready");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    try {
      await host.shutdown(signal);
      await shutdownQueue();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("resident bootstrap failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
