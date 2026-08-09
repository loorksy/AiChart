import { ResearchServiceError } from "./errors";
import {
  isTransientResearchError,
  researchHttpError,
  type ServiceErrorBody,
} from "./serviceErrors";
import type {
  CreateResearchSwarmInput,
  ResearchArtifactReference,
  ResearchCallerContext,
  ResearchJob,
  ResearchJobInput,
  ResearchProgressEvent,
  ResearchSwarmEvent,
  ResearchSwarmRun,
  ResearchSwarmTask,
} from "./types";

if (typeof window !== "undefined") {
  throw new Error("Research Service client is server-only");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function researchServiceEnabled(): boolean {
  return process.env.RESEARCH_SERVICE_ENABLED === "1";
}

export function researchBacktestEnabled(): boolean {
  return researchServiceEnabled() && process.env.RESEARCH_BACKTEST_ENABLED === "1";
}

export function researchValidationEnabled(): boolean {
  return researchBacktestEnabled() && process.env.RESEARCH_VALIDATION_ENABLED === "1";
}

export function researchSwarmEnabled(): boolean {
  return researchServiceEnabled() && process.env.RESEARCH_SWARM_ENABLED === "1";
}

export function researchSwarmPresetsEnabled(): boolean {
  return researchSwarmEnabled() && process.env.RESEARCH_SWARM_PRESETS_ENABLED === "1";
}

function requireResearchSwarmEnabled(): void {
  if (!researchSwarmEnabled() || !researchSwarmPresetsEnabled()) {
    throw new ResearchServiceError(
      "RESEARCH_SWARM_DISABLED",
      "Research Swarm presets are disabled",
      503,
    );
  }
}

export function requireResearchBacktestEnabled(): void {
  if (!researchServiceEnabled()) {
    throw new ResearchServiceError(
      "RESEARCH_SERVICE_DISABLED",
      "Research Service is disabled",
      503,
    );
  }
  if (!researchBacktestEnabled()) {
    throw new ResearchServiceError(
      "RESEARCH_BACKTEST_DISABLED",
      "Research backtesting is disabled",
      503,
    );
  }
}

function requireResearchValidationEnabled(): void {
  requireResearchBacktestEnabled();
  if (!researchValidationEnabled()) {
    throw new ResearchServiceError(
      "RESEARCH_VALIDATION_DISABLED",
      "Research validation is disabled",
      503,
    );
  }
}

function clientTimeoutMs(): number {
  const configured = Number(process.env.RESEARCH_SERVICE_CLIENT_TIMEOUT_MS || 10_000);
  return Number.isFinite(configured)
    ? Math.min(30_000, Math.max(100, configured))
    : 10_000;
}

function serviceConfig(): { url: string; token: string } {
  if (!researchServiceEnabled()) {
    throw new ResearchServiceError(
      "RESEARCH_SERVICE_DISABLED",
      "Research Service is disabled",
      503,
    );
  }
  const url = process.env.RESEARCH_SERVICE_URL?.trim().replace(/\/$/, "");
  const token = process.env.RESEARCH_SERVICE_INTERNAL_TOKEN?.trim();
  if (!url || !token || token.length < 16) {
    throw new ResearchServiceError(
      "RESEARCH_SERVICE_CONFIG_INVALID",
      "Research Service server configuration is incomplete",
      503,
    );
  }
  return { url, token };
}

async function serviceRequestOnce<T>(
  context: ResearchCallerContext,
  path: string,
  init: RequestInit = {},
  idempotencyKey?: string,
): Promise<T> {
  if (!Number.isInteger(context.userId) || context.userId <= 0 || !context.requestId) {
    throw new ResearchServiceError("RESEARCH_SERVICE_ERROR", "Invalid tenant context", 400);
  }
  const { url, token } = serviceConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clientTimeoutMs());
  try {
    const response = await fetch(`${url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-AiChart-Caller": "aichart-web",
        "X-AiChart-User-Id": String(context.userId),
        "X-AiChart-Request-Id": context.requestId,
        ...(idempotencyKey ? { "X-AiChart-Idempotency-Key": idempotencyKey } : {}),
        ...init.headers,
      },
    });
    const body = (await response.json().catch(() => ({}))) as T & ServiceErrorBody;
    if (!response.ok) {
      throw researchHttpError(response.status, body, path);
    }
    return body;
  } catch (error) {
    if (error instanceof ResearchServiceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ResearchServiceError(
        "RESEARCH_SERVICE_TIMEOUT",
        `Research Service request timed out after ${clientTimeoutMs()}ms (path=${path})`,
        504,
      );
    }
    const cause = error instanceof Error ? error.message : String(error);
    throw new ResearchServiceError(
      "RESEARCH_SERVICE_UNAVAILABLE",
      `Research Service connection error: ${cause} (path=${path})`,
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One automatic retry for transient timeout / connection failures before the
 * caller (or strategy job) is marked failed.
 */
async function serviceRequest<T>(
  context: ResearchCallerContext,
  path: string,
  init: RequestInit = {},
  idempotencyKey?: string,
): Promise<T> {
  try {
    return await serviceRequestOnce<T>(context, path, init, idempotencyKey);
  } catch (error) {
    if (!isTransientResearchError(error)) throw error;
    await sleep(250);
    return serviceRequestOnce<T>(context, path, init, idempotencyKey);
  }
}

export async function createResearchJob(
  context: ResearchCallerContext,
  input: ResearchJobInput,
): Promise<{ job: ResearchJob; created: boolean }> {
  if (input.jobType === "run_backtest_validation") {
    requireResearchValidationEnabled();
  } else if (
    input.jobType === "validate_strategy_spec" ||
    input.jobType === "validate_dataset" ||
    input.jobType === "run_forex_backtest"
  ) {
    requireResearchBacktestEnabled();
  }
  return serviceRequest(
    context,
    "/internal/research/jobs",
    {
      method: "POST",
      body: JSON.stringify({
        job_type: input.jobType,
        user_id: context.userId,
        request_id: context.requestId,
        idempotency_key: input.idempotencyKey,
        timeout_seconds: input.timeoutSeconds,
        max_retries: input.maxRetries,
        payload: input.payload || {},
      }),
    },
    input.idempotencyKey,
  );
}

export function getResearchJob(
  context: ResearchCallerContext,
  jobId: string,
): Promise<ResearchJob> {
  return serviceRequest(context, `/internal/research/jobs/${encodeURIComponent(jobId)}`);
}

/** Read a bounded, tenant-owned JSON artifact after a research job completes. */
export function getResearchJsonArtifact(
  context: ResearchCallerContext,
  jobId: string,
  artifactId: string,
): Promise<Record<string, unknown>> {
  requireResearchBacktestEnabled();
  return serviceRequest(
    context,
    `/internal/research/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
  );
}

/** Read bounded CSV artifact rows (equity curve, trade list) for visualization. */
export function getResearchCsvArtifact(
  context: ResearchCallerContext,
  jobId: string,
  artifactId: string,
): Promise<{ rows: Record<string, string>[] }> {
  requireResearchBacktestEnabled();
  return serviceRequest(
    context,
    `/internal/research/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifactId)}/csv`,
  );
}

export function cancelResearchJob(
  context: ResearchCallerContext,
  jobId: string,
): Promise<ResearchJob> {
  return serviceRequest(context, `/internal/research/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
}

export async function getResearchJobEvents(
  context: ResearchCallerContext,
  jobId: string,
): Promise<ResearchProgressEvent[]> {
  const result = await serviceRequest<{ events: ResearchProgressEvent[] }>(
    context,
    `/internal/research/jobs/${encodeURIComponent(jobId)}/events`,
  );
  return result.events;
}

function swarmBudgets(input: CreateResearchSwarmInput["budgets"]): Record<string, unknown> {
  if (!input) return {};
  return {
    token_budget: input.tokenBudget,
    cost_budget: input.costBudget,
    tool_call_budget: input.toolCallBudget,
    max_workers: input.maxWorkers,
    max_tasks: input.maxTasks,
    max_depth: input.maxDepth,
    run_timeout_seconds: input.runTimeoutSeconds,
    task_timeout_seconds: input.taskTimeoutSeconds,
    artifact_count: input.artifactCount,
    artifact_bytes: input.artifactBytes,
    progress_event_count: input.progressEventCount,
  };
}

export async function createResearchSwarmRun(
  context: ResearchCallerContext,
  input: CreateResearchSwarmInput,
): Promise<{ run: ResearchSwarmRun; created: boolean }> {
  requireResearchSwarmEnabled();
  return serviceRequest(
    context,
    "/internal/research/swarms",
    {
      method: "POST",
      body: JSON.stringify({
        preset: input.preset,
        title: input.title,
        objective: input.objective,
        idempotency_key: input.idempotencyKey,
        timeout_seconds: input.timeoutSeconds,
        max_attempts: input.maxAttempts,
        budgets: swarmBudgets(input.budgets),
        evidence_refs: (input.evidenceRefs || []).map((reference) => ({
          evidence_type: reference.evidenceType,
          reference_id: reference.referenceId,
          owner_user_id: context.userId,
          artifact_id: reference.artifactId,
        })),
        parameters: input.parameters || {},
      }),
    },
    input.idempotencyKey,
  );
}

export async function getResearchSwarmRun(
  context: ResearchCallerContext,
  runId: string,
): Promise<ResearchSwarmRun> {
  requireResearchSwarmEnabled();
  return await serviceRequest(context, `/internal/research/swarms/${encodeURIComponent(runId)}`);
}

export async function getResearchSwarmTasks(
  context: ResearchCallerContext,
  runId: string,
): Promise<ResearchSwarmTask[]> {
  requireResearchSwarmEnabled();
  const result = await serviceRequest<{ tasks: ResearchSwarmTask[] }>(
    context,
    `/internal/research/swarms/${encodeURIComponent(runId)}/tasks`,
  );
  return result.tasks;
}

export async function getResearchSwarmEvents(
  context: ResearchCallerContext,
  runId: string,
): Promise<ResearchSwarmEvent[]> {
  requireResearchSwarmEnabled();
  const result = await serviceRequest<{ events: ResearchSwarmEvent[] }>(
    context,
    `/internal/research/swarms/${encodeURIComponent(runId)}/events`,
  );
  return result.events;
}

export async function cancelResearchSwarmRun(
  context: ResearchCallerContext,
  runId: string,
): Promise<ResearchSwarmRun> {
  requireResearchSwarmEnabled();
  return await serviceRequest(
    context,
    `/internal/research/swarms/${encodeURIComponent(runId)}/cancel`,
    {
      method: "POST",
    },
  );
}

export async function getResearchSwarmArtifacts(
  context: ResearchCallerContext,
  runId: string,
): Promise<ResearchArtifactReference[]> {
  requireResearchSwarmEnabled();
  const result = await serviceRequest<{ artifacts: ResearchArtifactReference[] }>(
    context,
    `/internal/research/swarms/${encodeURIComponent(runId)}/artifacts`,
  );
  return result.artifacts;
}
