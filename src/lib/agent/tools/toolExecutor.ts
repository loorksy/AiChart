import { AgentToolError, normalizeToolError } from "./errors";
import { enforceToolPolicy } from "./toolPolicy";
import { redactedPreview } from "./toolTelemetry";
import type { AgentToolRegistry } from "./toolRegistry";
import type {
  AgentToolExecutionContext,
  AgentToolDefinition,
  AgentToolResult,
  AgentToolTelemetrySink,
} from "./types";

export class AgentToolExecutor {
  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly telemetry: AgentToolTelemetrySink = () => {},
  ) {}

  async execute<TInput, TOutput>(
    name: string,
    context: AgentToolExecutionContext,
    rawInput: unknown,
  ): Promise<AgentToolResult<TOutput>> {
    const started = Date.now();
    const definition = this.registry.get<TInput, TOutput>(name);
    if (!definition) return this.failure(name, context, started, rawInput, new AgentToolError("TOOL_NOT_FOUND", "Tool was not found."));
    const parsed = definition.inputSchema.safeParse(rawInput);
    if (!parsed.success) return this.failure(name, context, started, rawInput, new AgentToolError("TOOL_INPUT_INVALID", "Tool input did not match its schema."), definition.version, definition.permission);
    try {
      await enforceToolPolicy(definition, context);
      const key = definition.idempotencyKey?.(context, parsed.data);
      if (key && context.idempotencyLookup) {
        const cached = await context.idempotencyLookup(key);
        if (cached !== undefined) {
          return { ok: true, tool: name, version: definition.version, output: cached as TOutput, durationMs: Date.now() - started, cached: true };
        }
      }
      const output = await runWithTimeout(definition, context, parsed.data);
      const validated = definition.outputSchema?.safeParse(output);
      if (validated && !validated.success) throw new AgentToolError("TOOL_OUTPUT_INVALID", "Tool output did not match its schema.");
      const finalOutput = validated?.data ?? output;
      if (key && context.idempotencyStore) await context.idempotencyStore(key, finalOutput);
      context.calledTools?.add(name);
      const durationMs = Date.now() - started;
      void Promise.resolve(this.telemetry({
        requestId: context.requestId, userId: context.userId, tool: name,
        version: definition.version, permission: definition.permission, status: "completed",
        durationMs, inputPreview: redactedPreview(rawInput), outputPreview: redactedPreview(finalOutput),
      })).catch(() => {});
      return { ok: true, tool: name, version: definition.version, output: finalOutput, durationMs };
    } catch (error) {
      return this.failure(name, context, started, rawInput, normalizeToolError(error), definition.version, definition.permission);
    }
  }

  private failure<T>(
    name: string,
    context: AgentToolExecutionContext,
    started: number,
    input: unknown,
    error: AgentToolError,
    version?: string,
    permission?: AgentToolExecutionContext["permissions"] extends ReadonlySet<infer P> ? P : never,
  ): AgentToolResult<T> {
    const durationMs = Date.now() - started;
    const status = error.code === "TOOL_TIMEOUT" ? "timeout" : error.code === "TOOL_ABORTED" ? "aborted" : error.code === "TOOL_PERMISSION_DENIED" ? "denied" : "failed";
    void Promise.resolve(this.telemetry({
      requestId: context.requestId, userId: context.userId, tool: name, version,
      permission, status, durationMs, inputPreview: redactedPreview(input), errorCode: error.code,
    })).catch(() => {});
    return { ok: false, tool: name, version, error: { code: error.code, message: error.message }, durationMs };
  }
}

async function runWithTimeout<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>,
  context: AgentToolExecutionContext,
  input: TInput,
): Promise<TOutput> {
  if (context.signal?.aborted) throw new AgentToolError("TOOL_ABORTED", "Tool execution was aborted.");
  const controller = new AbortController();
  const abort = () => controller.abort(context.signal?.reason);
  context.signal?.addEventListener("abort", abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new AgentToolError("TOOL_TIMEOUT", "Tool execution timed out."));
      }, definition.timeoutMs);
    });
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => {
        if (context.signal?.aborted) reject(new AgentToolError("TOOL_ABORTED", "Tool execution was aborted."));
      }, { once: true });
    });
    return await Promise.race([
      definition.execute({ ...context, signal: controller.signal }, input), deadline, aborted,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    context.signal?.removeEventListener("abort", abort);
  }
}
