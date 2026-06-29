/**
 * Background job queue with a safe inline fallback.
 *
 * Heavy async work (embeddings, post-mortems) should not execute inside the
 * request/cron handler where it competes with user-facing latency and dies if
 * the invocation is frozen. When REDIS_URL is set, jobs are enqueued to BullMQ
 * and processed by a separate worker tier that scales independently. When it is
 * NOT set (local/dev), jobs run inline — exactly the previous fire-and-forget
 * behavior — so nothing breaks.
 */
import { captureError } from "./errorReporting";
import { createLogger } from "./logger";
import { metrics } from "./metrics";

const log = createLogger("queue");

export interface JobPayloads {
  trade_post_mortem: { userId: number; tradeId: number; pnl: number };
  opportunity_scan: { userId: number };
  memory_lifecycle: { userId: number; conversationId: number };
}
export type JobName = keyof JobPayloads;

type Handler<N extends JobName> = (payload: JobPayloads[N]) => Promise<void>;
type AnyHandler = (payload: unknown) => Promise<void>;

const handlers = new Map<JobName, AnyHandler>();

export function registerHandler<N extends JobName>(
  name: N,
  fn: Handler<N>,
): void {
  handlers.set(name, fn as AnyHandler);
}

export function hasHandler(name: JobName): boolean {
  return handlers.has(name);
}

/** Parse REDIS_URL into BullMQ-compatible connection options (avoids passing an
 *  ioredis instance, which clashes with BullMQ's bundled ioredis types). */
function redisConnection(): {
  host: string;
  port: number;
  password?: string;
  username?: string;
  db?: number;
  maxRetriesPerRequest: null;
} {
  const u = new URL(process.env.REDIS_URL!);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    maxRetriesPerRequest: null,
  };
}

export function queueEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

const QUEUE_NAME = "aichart-jobs";

let _registered = false;
async function ensureJobsRegistered(): Promise<void> {
  if (_registered) return;
  _registered = true;
  // Side-effecting import: registers all handlers. Dynamic so the producer
  // path doesn't eagerly pull heavy job dependencies until first use.
  await import("./jobs");
}

// ---- producer ----
let _queue: import("bullmq").Queue | null = null;
async function getQueue(): Promise<import("bullmq").Queue> {
  if (_queue) return _queue;
  const { Queue } = await import("bullmq");
  _queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
  return _queue;
}

export async function enqueue<N extends JobName>(
  name: N,
  payload: JobPayloads[N],
): Promise<void> {
  await ensureJobsRegistered();
  if (queueEnabled()) {
    try {
      const q = await getQueue();
      await q.add(name, payload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      });
      return;
    } catch (err) {
      // Never lose the job because the broker is unreachable: degrade to inline.
      log.error("enqueue failed; running inline", {
        name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await runInline(name, payload);
}

async function runInline<N extends JobName>(
  name: N,
  payload: JobPayloads[N],
): Promise<void> {
  const fn = handlers.get(name);
  if (!fn) {
    log.error("no handler registered", { name });
    return;
  }
  void fn(payload)
    .then(() => metrics.jobs.inc({ name, status: "completed" }))
    .catch((err) => {
      metrics.jobs.inc({ name, status: "dead" });
      void captureError(err, { scope: "queue.inline", name });
    });
}

// ---- consumer (worker tier) ----
let _worker: import("bullmq").Worker | null = null;

/** Start processing jobs. Called by the dedicated worker process. */
export async function startWorker(): Promise<void> {
  await ensureJobsRegistered();
  if (!queueEnabled()) {
    log.warn("REDIS_URL not set — worker has nothing to consume");
    return;
  }
  const { Worker } = await import("bullmq");
  _worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const fn = handlers.get(job.name as JobName);
      if (!fn) throw new Error(`no handler for job ${job.name}`);
      await fn(job.data);
    },
    {
      connection: redisConnection(),
      concurrency: Number(process.env.WORKER_CONCURRENCY || 5),
    },
  );
  _worker.on("failed", (job, err) => {
    const exhausted =
      !job || job.attemptsMade >= (job.opts.attempts ?? 1);
    metrics.jobs.inc({
      name: job?.name ?? "unknown",
      status: exhausted ? "dead" : "retry",
    });
    // A job that exhausted its retries is a dead-letter: surface it loudly.
    if (exhausted) {
      void captureError(err, {
        scope: "queue.dead_letter",
        name: job?.name,
        id: job?.id,
        data: job?.data,
      });
    } else {
      log.warn("job failed; will retry", {
        name: job?.name,
        id: job?.id,
        attempt: job?.attemptsMade,
        error: err.message,
      });
    }
  });
  _worker.on("completed", (job) => {
    metrics.jobs.inc({ name: job.name, status: "completed" });
    log.debug("job completed", { name: job.name, id: job.id });
  });
  log.info("worker started", { queue: QUEUE_NAME });
}

/** Close producer/consumer connections (graceful shutdown / tests). */
export async function shutdownQueue(): Promise<void> {
  await _worker?.close();
  await _queue?.close();
  _worker = null;
  _queue = null;
}
