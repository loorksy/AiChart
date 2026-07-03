import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeClient } from "../bridge/client.js";
import { registerAiChartTools } from "../tools/index.js";
import { instructionsCore } from "../onboarding/bootstrap.js";

export function createAiChartMcpServer(bridge: BridgeClient): McpServer {
  const server = new McpServer(
    {
      name: "aichart-trading",
      version: "1.0.0",
      websiteUrl: "https://aichart.lork.cloud",
    },
    {
      capabilities: { logging: {}, prompts: {} },
      // Short core (identity + hard rules) advertised at init so essentials
      // hold even before the user pastes the full bootstrap message.
      instructions: instructionsCore(),
    },
  );
  registerAiChartTools(server, bridge);
  return server;
}
