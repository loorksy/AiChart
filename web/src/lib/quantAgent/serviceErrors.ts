import { QuantAgentServiceError } from "./errors";

/** Mirrors web/src/lib/research/serviceErrors.ts. */
export interface ServiceErrorBody {
  error?: { code?: string; message?: string };
  detail?: unknown;
  message?: string;
}

/** Extracts a human-readable detail from FastAPI / Quant Agent error bodies. */
export function extractServiceErrorDetail(body: ServiceErrorBody): string | null {
  if (typeof body.error?.message === "string" && body.error.message.trim()) {
    return body.error.message.trim();
  }
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message.trim();
  }
  const detail = body.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          const msg = (item as { msg?: unknown }).msg;
          return typeof msg === "string" ? msg : null;
        }
        return null;
      })
      .filter((part): part is string => Boolean(part?.trim()));
    if (parts.length) return parts.join("; ");
  }
  return null;
}

function classifyHttpFailure(status: number, path: string, detail: string | null): string {
  const lower = `${detail ?? ""} ${path}`.toLowerCase();
  if (status === 404 && /\/recommendations\/[^/?]+/.test(path)) {
    return "QUANT_AGENT_RECOMMENDATION_NOT_FOUND";
  }
  if (status === 404) return "QUANT_AGENT_ENDPOINT_NOT_FOUND";
  if (status === 408 || status === 504) return "QUANT_AGENT_SERVICE_TIMEOUT";
  if (status === 502 || status === 503) return "QUANT_AGENT_SERVICE_UNAVAILABLE";
  if (status === 422) return "QUANT_AGENT_INPUT_INVALID";
  if (status >= 500) return "QUANT_AGENT_SERVICE_ERROR";
  void lower;
  return "QUANT_AGENT_SERVICE_ERROR";
}

/** Builds a detailed QuantAgentServiceError that never hides HTTP status / detail. */
export function quantAgentHttpError(
  status: number,
  body: ServiceErrorBody,
  path: string,
): QuantAgentServiceError {
  const detail = extractServiceErrorDetail(body);
  const code =
    (typeof body.error?.code === "string" && body.error.code.trim()) ||
    classifyHttpFailure(status, path, detail);
  const base = detail || "Quant Agent Service request failed";
  const message = `${base} (HTTP ${status}, ${code}, path=${path})`;
  return new QuantAgentServiceError(code, message, status);
}

export function formatQuantAgentFailure(error: unknown): string {
  if (error instanceof QuantAgentServiceError) {
    const status = error.status != null ? ` HTTP ${error.status}` : "";
    return `${error.message} [${error.code}${status}]`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isTransientQuantAgentError(error: unknown): boolean {
  if (!(error instanceof QuantAgentServiceError)) return false;
  if (
    error.code === "QUANT_AGENT_SERVICE_TIMEOUT" ||
    error.code === "QUANT_AGENT_SERVICE_UNAVAILABLE"
  ) {
    return true;
  }
  return error.status === 502 || error.status === 503 || error.status === 504;
}
