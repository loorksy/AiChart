import { ResearchServiceError } from "./errors";
import type {
  ResearchCallerContext,
  ResearchJob,
  ResearchJobInput,
  ResearchProgressEvent,
} from "./types";

if (typeof window !== "undefined") {
  throw new Error("Research Service client is server-only");
}

interface ServiceErrorBody {
  error?: { code?: string; message?: string };
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

async function serviceRequest<T>(
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
      throw new ResearchServiceError(
        body.error?.code || "RESEARCH_SERVICE_ERROR",
        body.error?.message || "Research Service request failed",
        response.status,
      );
    }
    return body;
  } catch (error) {
    if (error instanceof ResearchServiceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ResearchServiceError(
        "RESEARCH_SERVICE_TIMEOUT",
        "Research Service request timed out",
        504,
      );
    }
    throw new ResearchServiceError(
      "RESEARCH_SERVICE_UNAVAILABLE",
      "Research Service is unavailable",
      503,
    );
  } finally {
    clearTimeout(timer);
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
