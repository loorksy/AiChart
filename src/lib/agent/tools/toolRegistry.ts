import type { AgentToolDefinition } from "./types";

type StoredDefinition = AgentToolDefinition<unknown, unknown>;

export class AgentToolRegistry {
  private readonly tools = new Map<string, StoredDefinition>();

  register<TInput, TOutput>(definition: AgentToolDefinition<TInput, TOutput>): void {
    if (this.tools.has(definition.name)) throw new Error(`Duplicate tool: ${definition.name}`);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(definition.name)) throw new Error("Invalid tool name");
    if (definition.timeoutMs < 1 || definition.timeoutMs > 120_000) throw new Error("Invalid tool timeout");
    if (definition.readOnly && definition.riskClass !== "read") throw new Error("Read-only tool must use read risk class");
    this.tools.set(definition.name, definition as unknown as StoredDefinition);
  }

  get<TInput = unknown, TOutput = unknown>(name: string): AgentToolDefinition<TInput, TOutput> | undefined {
    return this.tools.get(name) as AgentToolDefinition<TInput, TOutput> | undefined;
  }

  list(): StoredDefinition[] { return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name)); }
}
