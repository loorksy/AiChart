import type { AgentToolExecutor } from "./toolExecutor";
import type { AgentToolRegistry } from "./toolRegistry";
import type { AgentToolExecutionContext } from "./types";

/** Read-only bridge contract; actual MCP names/responses remain unchanged. */
export function createCommonToolMcpAdapter(registry: AgentToolRegistry, executor: AgentToolExecutor) {
  return {
    list: () => registry.list().filter((tool) => tool.readOnly).map((tool) => ({
      name: tool.name,
      version: tool.version,
      description: tool.description,
      permission: tool.permission,
      readOnly: tool.readOnly,
      inputSchema: tool.inputSchema,
    })),
    call: (name: string, context: AgentToolExecutionContext, input: unknown) => executor.execute(name, context, input),
  } as const;
}
