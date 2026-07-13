import type { z } from "zod";

export type AgentToolPermission =
  | "market.read" | "chart.read" | "chart.write" | "account.read"
  | "recommendation.read" | "recommendation.write" | "trade.recommend"
  | "trade.execute" | "trade.manage" | "memory.read" | "memory.write"
  | "research.run" | "report.generate" | "admin";
export type AgentToolRiskClass = "read" | "write" | "recommendation" | "execution";
export type AgentToolCostClass = "low" | "medium" | "high";

export interface AgentToolAvailabilityContext {
  userId: number;
  featureFlags: ReadonlySet<string>;
  providers: ReadonlySet<string>;
}

export interface AgentToolExecutionContext extends AgentToolAvailabilityContext {
  requestId: string;
  permissions: ReadonlySet<AgentToolPermission>;
  signal?: AbortSignal;
  calledTools?: Set<string>;
  idempotencyLookup?: (key: string) => Promise<unknown | undefined>;
  idempotencyStore?: (key: string, value: unknown) => Promise<void>;
}

export interface AgentToolDefinition<TInput, TOutput> {
  name: string;
  version: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  readOnly: boolean;
  repeatable: boolean;
  timeoutMs: number;
  permission: AgentToolPermission;
  riskClass: AgentToolRiskClass;
  costClass: AgentToolCostClass;
  requiredFeatureFlags?: string[];
  requiredProviders?: string[];
  available(context: AgentToolAvailabilityContext): Promise<boolean> | boolean;
  idempotencyKey?: (context: AgentToolExecutionContext, input: TInput) => string | undefined;
  execute(context: AgentToolExecutionContext, input: TInput): Promise<TOutput>;
}

export type AgentToolErrorCode =
  | "TOOL_NOT_FOUND" | "TOOL_UNAVAILABLE" | "TOOL_PERMISSION_DENIED"
  | "TOOL_INPUT_INVALID" | "TOOL_OUTPUT_INVALID" | "TOOL_TIMEOUT"
  | "TOOL_ABORTED" | "TOOL_PROVIDER_ERROR" | "TOOL_INTERNAL_ERROR";

export interface AgentToolResult<T = unknown> {
  ok: boolean;
  tool: string;
  version?: string;
  output?: T;
  error?: { code: AgentToolErrorCode; message: string };
  durationMs: number;
  cached?: boolean;
}

export interface AgentToolTelemetryEvent {
  requestId: string;
  userId: number;
  tool: string;
  version?: string;
  permission?: AgentToolPermission;
  status: "completed" | "failed" | "denied" | "timeout" | "aborted";
  durationMs: number;
  inputPreview: string;
  outputPreview?: string;
  errorCode?: AgentToolErrorCode;
}

export type AgentToolTelemetrySink = (event: AgentToolTelemetryEvent) => void | Promise<void>;
