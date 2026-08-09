import { AgentToolError } from "./errors";
import type { AgentToolDefinition, AgentToolExecutionContext } from "./types";

export async function enforceToolPolicy<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>,
  context: AgentToolExecutionContext,
): Promise<void> {
  if (!context.permissions.has(definition.permission)) {
    throw new AgentToolError("TOOL_PERMISSION_DENIED", "Server policy denied this tool permission.");
  }
  if (definition.requiredFeatureFlags?.some((flag) => !context.featureFlags.has(flag))) {
    throw new AgentToolError("TOOL_UNAVAILABLE", "A required feature is disabled.");
  }
  if (definition.requiredProviders?.some((provider) => !context.providers.has(provider))) {
    throw new AgentToolError("TOOL_UNAVAILABLE", "A required provider is unavailable.");
  }
  if (!(await definition.available(context))) {
    throw new AgentToolError("TOOL_UNAVAILABLE", "Tool dependencies are unavailable.");
  }
  if (!definition.repeatable && context.calledTools?.has(definition.name)) {
    throw new AgentToolError("TOOL_PERMISSION_DENIED", "Non-repeatable tool was already called in this run.");
  }
}
