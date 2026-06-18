import type { z } from "zod";
import type { ToolAnnotations } from "../registry.js";

export type ToolDomain = "core" | "market" | "binance" | "mt5";

export interface ToolDefinition {
  name: string;
  domain: ToolDomain;
  description: string;
  inputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
}
