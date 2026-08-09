/**
 * Dedicated background worker process. Run separately from the Next.js web
 * server (pm2 app `aichart-worker` / `npm run worker`) so long-running jobs
 * (embeddings, post-mortems) scale independently and never block requests.
 *
 * Requires REDIS_URL. With it unset this exits early (web runs jobs inline).
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { initDb } from "./lib/db";
import { createLogger } from "./lib/logger";
import { shutdownQueue, startWorker } from "./lib/queue";

const log = createLogger("worker");

async function main(): Promise<void> {
  await initDb();
  await startWorker();

  // V2-B (#96): every 5 minutes, undeploy idle MetaApi accounts so nobody
  // pays for a terminal their owner isn't watching. No-op while
  // METAAPI_UX_ENABLED is off; fail-soft — a sweep error never kills the worker.
  setInterval(() => {
    void (async () => {
      try {
        const { sweepIdleDeployments } = await import("./lib/metaapi/lifecycle");
        const count = await sweepIdleDeployments();
        if (count > 0) log.info("metaapi.sweep", { undeployed: count });
      } catch (err) {
        log.warn("metaapi.sweep_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, 5 * 60 * 1000);
  // Resume or safely re-queue Deep Analysis polls after restart.
  try {
    const { reconcilePendingDeepAnalysis } = await import(
      "./lib/agent/deepAnalysis/completion"
    );
    const n = await reconcilePendingDeepAnalysis();
    if (n > 0) log.info("reconciled pending deep analysis runs", { count: n });
  } catch (err) {
    log.warn("deep analysis reconcile skipped", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  log.info("worker process ready");

  // Graceful shutdown: stop accepting jobs and drain in-flight ones so an
  // orchestrator restart/scale-down never kills a job mid-execution.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    try {
      await shutdownQueue();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("worker bootstrap failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
