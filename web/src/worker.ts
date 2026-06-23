/**
 * Dedicated background worker process. Run separately from the Next.js web
 * server (pm2 app `aichart-worker` / `npm run worker`) so long-running jobs
 * (embeddings, post-mortems) scale independently and never block requests.
 *
 * Requires REDIS_URL. With it unset this exits early (web runs jobs inline).
 */
import { initDb } from "./lib/db";
import { createLogger } from "./lib/logger";
import { shutdownQueue, startWorker } from "./lib/queue";

const log = createLogger("worker");

async function main(): Promise<void> {
  await initDb();
  await startWorker();
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
