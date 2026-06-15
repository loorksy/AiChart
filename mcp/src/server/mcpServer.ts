import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeClient } from "../bridge/client.js";
import { registerAiChartTools } from "../tools/index.js";

export function createAiChartMcpServer(bridge: BridgeClient): McpServer {
  const server = new McpServer(
    {
      name: "aichart-trading",
      version: "1.0.0",
      websiteUrl: "https://aichart.lork.cloud",
    },
    { capabilities: { logging: {} } },
  );
  registerAiChartTools(server, bridge);
  return server;
}
