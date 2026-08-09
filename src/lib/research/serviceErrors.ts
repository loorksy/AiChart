import { ResearchServiceError } from "./errors";

export interface ServiceErrorBody {
  error?: { code?: string; message?: string };
  detail?: unknown;
  message?: string;
}

/** Extracts a human-readable detail from FastAPI / Research Service error bodies. */
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

function classifyHttpFailure(
  status: number,
  path: string,
  detail: string | null,
): string {
  const lower = `${detail ?? ""} ${path}`.toLowerCase();
  if (status === 404 && lower.includes("artifact")) {
    return "RESEARCH_ARTIFACT_NOT_FOUND";
  }
  if (status === 404 && lower.includes("/content")) {
    return "RESEARCH_ARTIFACT_CONTENT_UNAVAILABLE";
  }
  if (status === 404) return "RESEARCH_ENDPOINT_NOT_FOUND";
  if (status === 408 || status === 504) return "RESEARCH_SERVICE_TIMEOUT";
  if (status === 502 || status === 503) return "RESEARCH_SERVICE_UNAVAILABLE";
  if (status === 409) return "IDEMPOTENCY_CONFLICT";
  if (status === 422) return "RESEARCH_INPUT_INVALID";
  if (status >= 500) return "RESEARCH_SERVICE_ERROR";
  return "RESEARCH_SERVICE_ERROR";
}

/** Builds a detailed ResearchServiceError that never hides HTTP status / detail. */
export function researchHttpError(
  status: number,
  body: ServiceErrorBody,
  path: string,
): ResearchServiceError {
  const detail = extractServiceErrorDetail(body);
  const code =
    (typeof body.error?.code === "string" && body.error.code.trim()) ||
    classifyHttpFailure(status, path, detail);
  const base =
    detail ||
    (status === 404 && path.includes("/content")
      ? "Research artifact content endpoint returned Not Found (service may be outdated or artifact missing)"
      : "Research Service request failed");
  const message = `${base} (HTTP ${status}, ${code}, path=${path})`;
  return new ResearchServiceError(code, message, status);
}

export function formatResearchFailure(error: unknown): string {
  if (error instanceof ResearchServiceError) {
    const status = error.status != null ? ` HTTP ${error.status}` : "";
    return `${error.message} [${error.code}${status}]`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isTransientResearchError(error: unknown): boolean {
  if (!(error instanceof ResearchServiceError)) return false;
  if (
    error.code === "RESEARCH_SERVICE_TIMEOUT" ||
    error.code === "RESEARCH_SERVICE_UNAVAILABLE"
  ) {
    return true;
  }
  return error.status === 502 || error.status === 503 || error.status === 504;
}
