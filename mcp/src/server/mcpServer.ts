import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  EXTENSION_ID,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { BridgeClient } from "../bridge/client.js";
import { registerAiChartTools } from "../tools/index.js";
import { instructionsCore } from "../onboarding/bootstrap.js";
import { MCP_SERVER_VERSION } from "../tools/registry.js";

export function createAiChartMcpServer(bridge: BridgeClient): McpServer {
  const server = new McpServer(
    {
      name: "aichart-trading",
      title: "Lonora Trading",
      version: MCP_SERVER_VERSION,
      websiteUrl: "https://aichart.lork.cloud",
      // Current Lonora brand mark (web origin — the MCP origin serves no
      // statics). Theme variants let hosts pick the right contrast.
      icons: [
        {
          src: "https://aichart.lork.cloud/icon-512.png",
          mimeType: "image/png",
          sizes: ["512x512"],
        },
        {
          src: "https://aichart.lork.cloud/brand/aichart-mark-dark.png",
          mimeType: "image/png",
          theme: "dark",
        },
        {
          src: "https://aichart.lork.cloud/brand/aichart-mark-light.png",
          mimeType: "image/png",
          theme: "light",
        },
      ],
    },
    {
      capabilities: {
        logging: {},
        prompts: {},
        extensions: {
          [EXTENSION_ID]: {
            mimeTypes: [RESOURCE_MIME_TYPE],
          },
        },
      },
      // Short core (identity + hard rules) advertised at init so essentials
      // hold even before the user pastes the full bootstrap message.
      instructions: instructionsCore(),
    },
  );
  registerAiChartTools(server, bridge);
  return server;
}
