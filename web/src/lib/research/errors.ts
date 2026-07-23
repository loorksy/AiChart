export type ResearchServiceErrorCode =
  | "RESEARCH_SERVICE_DISABLED"
  | "RESEARCH_SERVICE_CONFIG_INVALID"
  | "RESEARCH_SERVICE_TIMEOUT"
  | "RESEARCH_SERVICE_UNAVAILABLE"
  | "RESEARCH_BACKTEST_DISABLED"
  | "RESEARCH_VALIDATION_DISABLED"
  | "RESEARCH_SWARM_DISABLED"
  | "RESEARCH_INPUT_INVALID"
  | "RESEARCH_ARTIFACT_NOT_FOUND"
  | "RESEARCH_ARTIFACT_CONTENT_UNAVAILABLE"
  | "RESEARCH_ENDPOINT_NOT_FOUND"
  | "RESEARCH_SERVICE_ERROR";

export class ResearchServiceError extends Error {
  constructor(
    public readonly code: ResearchServiceErrorCode | string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ResearchServiceError";
  }
}
