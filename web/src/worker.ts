/**
 * Dedicated background worker process. Run separately from the Next.js web
 * server (pm2 app `aichart-worker` / `npm run worker`) so long-running jobs
 * (embeddings, post-mortems) scale independently and never block requests.
 *
 * Requires REDIS_URL. With it unset this exits early (web runs jobs inline).
 */
import { initDb } from "./lib/db";
import { createLogger } from "./lib/logger";
import { startWorker } from "./lib/queue";

const log = createLogger("worker");

async function main(): Promise<void> {
  await initDb();
  await startWorker();
  log.info("worker process ready");
}

main().catch((err) => {
  log.error("worker bootstrap failed", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
