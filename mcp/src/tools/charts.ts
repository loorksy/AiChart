import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { bridgeCall } from "./helpers.js";
import { mcpToolConfig } from "./schemas/index.js";

/** Full AI analysis can take ~2 minutes (LLM + vision + committee). */
const ANALYZE_TIMEOUT_MS = 150_000;
/** Drawing needs one candles fetch for time anchoring. */
const DRAW_TIMEOUT_MS = 30_000;

/**
 * Live-chart tools: the assistant reads and DRAWS on the user's actual
 * TradingView chart (aichart.lork.cloud/chart/<layoutId>). Writes go through
 * the same validation pipeline as platform analysis; the open chart picks
 * them up within ~4s via its live-refresh poll.
 */
export function registerChartsTools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "list_chart_layouts",
    mcpToolConfig("list_chart_layouts"),
    async () => {
      return bridgeCall(() => bridge.get("/api/agent/chart/layout"));
    },
  );

  server.registerTool(
    "get_chart_state",
    mcpToolConfig("get_chart_state"),
    async (args) => {
      const { layout_id } = args as { layout_id?: string };
      if (layout_id) {
        return bridgeCall(() =>
          bridge.get("/api/agent/chart/layout", { id: layout_id }),
        );
      }
      // No id → resolve the user's primary layout via the list.
      return bridgeCall(async () => {
        const list = (await bridge.get("/api/agent/chart/layout")) as {
          layouts?: Array<{ id: string }>;
        };
        const first = list.layouts?.[0];
        if (!first) return { layouts: [] };
        return bridge.get("/api/agent/chart/layout", { id: first.id });
      });
    },
  );

  server.registerTool(
    "draw_on_chart",
    mcpToolConfig("draw_on_chart"),
    async (args) => {
      const a = args as Record<string, unknown>;
      return bridgeCall(() =>
        bridge.post(
          "/api/agent/chart/layout",
          {
            id: a.layout_id,
            symbol: a.symbol,
            interval: a.interval,
            mode: a.mode ?? "set",
            drawings: a.drawings ?? [],
            recommendation: a.recommendation,
            targets: a.targets,
          },
          DRAW_TIMEOUT_MS,
        ),
        { structured: true },
      );
    },
  );

  server.registerTool(
    "clear_chart_drawings",
    mcpToolConfig("clear_chart_drawings"),
    async (args) => {
      const { layout_id } = args as { layout_id?: string };
      return bridgeCall(() =>
        bridge.post("/api/agent/chart/layout", {
          id: layout_id,
          mode: "clear",
        }),
      );
    },
  );

  server.registerTool(
    "run_market_analysis",
    mcpToolConfig("run_market_analysis"),
    async (args) => {
      const a = args as {
        symbol?: string;
        interval?: string;
        market?: "crypto" | "forex";
        layout_id?: string;
        data_source?: "oanda" | "ea";
      };
      return bridgeCall(
        () =>
          bridge.post(
            "/api/agent/market/analyze",
            {
              symbol: a.symbol,
              interval: a.interval ?? "1h",
              market: a.market,
              layout_id: a.layout_id,
              data_source: a.data_source,
            },
            ANALYZE_TIMEOUT_MS,
          ),
        { structured: true },
      );
    },
  );
}
