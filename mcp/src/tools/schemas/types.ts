import type { z } from "zod";
import type { ToolAnnotations } from "../registry.js";

export type ToolDomain = "core" | "market" | "mt5" | "charts";

export interface ToolDefinition {
  name: string;
  domain: ToolDomain;
  description: string;
  inputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
  /** One of the two MCP Apps templates: `live-chart` or `recommendation-card`.
   *  Tools without this field must never be presented as a card. */
  ui?: { widget: string };
}
