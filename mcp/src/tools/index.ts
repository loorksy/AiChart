import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { tradingRulesText } from "./helpers.js";
import { registerMarketTools } from "./market.js";
import { registerCoreTools } from "./core.js";
import { registerBinanceTools } from "./binance.js";
import { registerMt5Tools } from "./mt5.js";

export function registerAiChartTools(server: McpServer, bridge: BridgeClient) {
  server.registerResource(
    "trading-rules",
    "aichart://trading-rules",
    {
      title: "AiChart Trading Rules",
      description: "قواعد التشغيل والتداول للمشغّل",
      mimeType: "text/markdown",
    },
    async () => ({
      contents: [
        {
          uri: "aichart://trading-rules",
          mimeType: "text/markdown",
          text: tradingRulesText(),
        },
      ],
    }),
  );

  registerCoreTools(server, bridge);
  registerMarketTools(server, bridge);
  registerBinanceTools(server, bridge);
  registerMt5Tools(server, bridge);
}
