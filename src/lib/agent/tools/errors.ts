import type { AgentToolErrorCode } from "./types";

export class AgentToolError extends Error {
  constructor(public readonly code: AgentToolErrorCode, message: string) {
    super(message);
    this.name = "AgentToolError";
  }
}

export function normalizeToolError(error: unknown): AgentToolError {
  if (error instanceof AgentToolError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new AgentToolError("TOOL_ABORTED", "Tool execution was aborted.");
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/provider|upstream|network|fetch/.test(message)) {
    return new AgentToolError("TOOL_PROVIDER_ERROR", "The required provider failed.");
  }
  return new AgentToolError("TOOL_INTERNAL_ERROR", "Tool execution failed safely.");
}
