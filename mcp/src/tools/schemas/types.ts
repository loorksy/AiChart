import type { z } from "zod";
import type { ToolAnnotations } from "../registry.js";

export type ToolDomain = "core" | "market" | "mt5" | "charts";

/** Flat shape (most tools) or a full Zod schema (discriminated unions). */
export type ToolInputSchema = z.ZodRawShape | z.ZodType;

export interface ToolDefinition {
  name: string;
  domain: ToolDomain;
  description: string;
  inputSchema: ToolInputSchema;
  annotations: ToolAnnotations;
  /** Interactive card rendered for this tool's result (MCP Apps + ChatGPT). */
  ui?: { widget: string };
}
