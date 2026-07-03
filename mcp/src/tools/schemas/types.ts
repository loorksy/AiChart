import type { z } from "zod";
import type { ToolAnnotations } from "../registry.js";

export type ToolDomain = "core" | "market" | "binance" | "mt5" | "charts";

export interface ToolDefinition {
  name: string;
  domain: ToolDomain;
  description: string;
  inputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
  /** Interactive card rendered for this tool's result (MCP Apps + ChatGPT). */
  ui?: { widget: string };
}
