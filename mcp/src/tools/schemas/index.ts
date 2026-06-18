import { BINANCE_TOOL_DEFINITIONS } from "./binanceSchemas.js";
import { CORE_TOOL_DEFINITIONS } from "./coreSchemas.js";
import { MARKET_TOOL_DEFINITIONS } from "./marketSchemas.js";
import { MT5_TOOL_DEFINITIONS } from "./mt5Schemas.js";
import { toolConfig } from "../registry.js";
import type { ToolDefinition } from "./types.js";

export const TOOL_CATALOG: ToolDefinition[] = [
  ...CORE_TOOL_DEFINITIONS,
  ...MARKET_TOOL_DEFINITIONS,
  ...BINANCE_TOOL_DEFINITIONS,
  ...MT5_TOOL_DEFINITIONS,
];

export const TOOL_BY_NAME: Record<string, ToolDefinition> = Object.fromEntries(
  TOOL_CATALOG.map((t) => [t.name, t]),
);

export function getToolDef(name: string): ToolDefinition {
  const def = TOOL_BY_NAME[name];
  if (!def) throw new Error(`Unknown MCP tool: ${name}`);
  return def;
}

/** registerTool config from catalog — includes inputSchema for handler type inference. */
export function mcpToolConfig(name: string) {
  const def = getToolDef(name);
  return {
    ...toolConfig(def),
    inputSchema: def.inputSchema,
  };
}

export type { ToolDefinition, ToolDomain } from "./types.js";
