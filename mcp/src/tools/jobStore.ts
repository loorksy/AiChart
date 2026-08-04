import { randomUUID } from "node:crypto";

/**
 * In-process async job registry for bucket-C (long-running) tools.
 *
 * Scope, stated plainly: jobs live in THIS server process's memory only —
 * not persisted, not shared across server instances or restarts. That is
 * sufficient for the problem this solves (a single tool call that would
 * otherwise block the MCP transport for 60-150s) as long as the connection
 * that started the job is the one that later calls jobs_wait/show_jobs_by_ids,
 * which holds for a normal single-session conversation. It does NOT hold
 * across a server restart or a load-balanced multi-instance deployment — a
 * real limitation, not an oversight; flagged here and in the PR rather than
 * silently assumed away.
 */

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobRecord {
  id: string;
  tool: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
}

const JOBS = new Map<string, JobRecord>();

/** Finished jobs are swept after this long so a forgotten job_id doesn't leak memory. */
const JOB_RETENTION_MS = 30 * 60 * 1000;

function sweep(): void {
  const cutoff = Date.now() - JOB_RETENTION_MS;
  for (const [id, job] of JOBS) {
    if (isTerminal(job.status) && job.updatedAt < cutoff) JOBS.delete(id);
  }
}

export function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed";
}

/**
 * Starts `work` in the background and returns immediately with a queued job
 * record — the tool handler that calls this must return the record without
 * awaiting `work`, so the MCP response comes back in well under 500ms
 * regardless of how long the real work takes. A microtask flips the record
 * to "running" right after (before `work`'s own awaited I/O could resolve),
 * so a poll that lands after this synchronous return sees an accurate state
 * instead of "queued" for the entire duration.
 */
export function startJob(tool: string, work: () => Promise<unknown>): JobRecord {
  sweep();
  const now = Date.now();
  const record: JobRecord = {
    id: `job_${randomUUID()}`,
    tool,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  JOBS.set(record.id, record);
  queueMicrotask(() => {
    if (record.status === "queued") {
      record.status = "running";
      record.updatedAt = Date.now();
    }
  });
  work()
    .then((result) => {
      record.status = "completed";
      record.result = result;
      record.updatedAt = Date.now();
    })
    .catch((err) => {
      record.status = "failed";
      record.error = err instanceof Error ? err.message : String(err);
      record.updatedAt = Date.now();
    });
  return record;
}

export function getJob(id: string): JobRecord | undefined {
  return JOBS.get(id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Long-polls until every listed job is terminal or `maxWaitMs` elapses,
 * whichever is first. Unknown job ids are reported, not thrown on — a job
 * from a different server instance/restart is a real, expected case here.
 */
export async function waitForJobs(
  ids: string[],
  maxWaitMs = 20_000,
  pollIntervalMs = 500,
): Promise<{
  jobs: Array<{
    id: string;
    tool?: string;
    status: JobStatus | "not_found";
    result?: unknown;
    error?: string;
  }>;
  all_terminal: boolean;
  poll_after_seconds: number | null;
}> {
  const deadline = Date.now() + maxWaitMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const records = ids.map((id) => getJob(id));
    const allDone = records.every((r) => !r || isTerminal(r.status));
    if (allDone || Date.now() >= deadline) {
      return {
        jobs: records.map((r, i) => {
          if (!r) return { id: ids[i]!, status: "not_found" as const };
          return {
            id: r.id,
            tool: r.tool,
            status: r.status,
            ...(r.status === "completed" ? { result: r.result } : {}),
            ...(r.status === "failed" ? { error: r.error } : {}),
          };
        }),
        all_terminal: allDone,
        poll_after_seconds: allDone ? null : 5,
      };
    }
    await sleep(pollIntervalMs);
  }
}
