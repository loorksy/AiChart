import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { bridgeCall } from "./helpers.js";
import { mcpToolConfig } from "./schemas/index.js";

/**
 * Quant Agent — a separate, independent strategy engine from Lonora (see the
 * disambiguation prefix on every tool description in
 * schemas/quantAgentSchemas.ts). These handlers call the same frozen
 * `/api/quant-agent/recommendations` web routes every other MCP tool reaches
 * `/api/agent/*` through — via the shared `bridge` client — and never touch
 * Lonora's canonical recommendation store or any broker account.
 */
export function registerQuantAgentTools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "quant_agent_generate_recommendation",
    mcpToolConfig("quant_agent_generate_recommendation"),
    async (args) => {
      const { symbol, market, interval } = args as {
        symbol: string;
        market?: "forex";
        interval: string;
      };
      return bridgeCall(
        "quant_agent_generate_recommendation",
        args as Record<string, unknown>,
        () =>
          bridge.post("/api/quant-agent/recommendations", {
            symbol: symbol.trim(),
            market: market ?? "forex",
            interval,
          }),
      );
    },
  );

  server.registerTool(
    "quant_agent_list_recommendations",
    mcpToolConfig("quant_agent_list_recommendations"),
    async (args) => {
      const { symbol, state } = args as {
        symbol?: string;
        state?: string;
      };
      return bridgeCall(
        "quant_agent_list_recommendations",
        args as Record<string, unknown>,
        () =>
          bridge.get("/api/quant-agent/recommendations", {
            symbol: symbol?.trim(),
            state,
          }),
      );
    },
  );

  server.registerTool(
    "quant_agent_get_recommendation",
    mcpToolConfig("quant_agent_get_recommendation"),
    async (args) => {
      const { id } = args as { id: string };
      return bridgeCall(
        "quant_agent_get_recommendation",
        args as Record<string, unknown>,
        () => bridge.get(`/api/quant-agent/recommendations/${encodeURIComponent(id.trim())}`),
      );
    },
  );
}
