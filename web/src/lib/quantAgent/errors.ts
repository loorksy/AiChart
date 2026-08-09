export type QuantAgentServiceErrorCode =
  | "QUANT_AGENT_SERVICE_DISABLED"
  | "QUANT_AGENT_SERVICE_CONFIG_INVALID"
  | "QUANT_AGENT_SERVICE_TIMEOUT"
  | "QUANT_AGENT_SERVICE_UNAVAILABLE"
  | "QUANT_AGENT_INPUT_INVALID"
  | "QUANT_AGENT_RECOMMENDATION_NOT_FOUND"
  | "QUANT_AGENT_ENDPOINT_NOT_FOUND"
  | "QUANT_AGENT_SERVICE_ERROR";

/** Mirrors ResearchServiceError — see web/src/lib/research/errors.ts. */
export class QuantAgentServiceError extends Error {
  constructor(
    public readonly code: QuantAgentServiceErrorCode | string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "QuantAgentServiceError";
  }
}
