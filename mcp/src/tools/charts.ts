import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge/client.js";
import { BridgeError } from "../bridge/client.js";
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
    "show_live_chart",
    mcpToolConfig("show_live_chart"),
    async (args) => {
      const a = args as {
        symbol?: string;
        interval?: string;
        layout_id?: string;
        market?: "crypto" | "forex";
      };
      return bridgeCall(async () => {
        // Layout is optional context (drawings/recommendation); the chart
        // renders from candles alone when the user has no saved layout.
        type LayoutRes = {
          id?: string;
          symbol?: string;
          interval?: string;
          state?: Record<string, unknown>;
          url?: string;
        };
        let layout: LayoutRes | null = null;
        try {
          if (a.layout_id) {
            layout = (await bridge.get("/api/agent/chart/layout", {
              id: a.layout_id,
            })) as LayoutRes;
          } else {
            const list = (await bridge.get("/api/agent/chart/layout")) as {
              layouts?: Array<{ id: string; symbol?: string }>;
            };
            const wanted = a.symbol?.toUpperCase();
            const pick =
              (wanted &&
                list.layouts?.find(
                  (l) => l.symbol?.toUpperCase() === wanted,
                )) ||
              list.layouts?.[0];
            if (pick) {
              layout = (await bridge.get("/api/agent/chart/layout", {
                id: pick.id,
              })) as LayoutRes;
            }
          }
        } catch {
          layout = null;
        }
        const symbol = (a.symbol ?? layout?.symbol ?? "").toUpperCase().trim();
        if (!symbol) {
          throw new BridgeError(
            "حدد symbol أو أنشئ شارتاً أولاً (list_chart_layouts).",
            400,
            null,
          );
        }
        const interval = a.interval ?? layout?.interval ?? "15m";
        // Broker-suffixed symbols (XAUUSDM…) only exist on the EA bridge —
        // honor the layout's dataSource, then fall back to EA on empty.
        const layoutSource = (layout?.state as { dataSource?: string } | undefined)
          ?.dataSource;
        // EA roundtrip can take ~25s through the terminal queue.
        const fetchCandles = (source?: string) =>
          bridge.get(
            "/api/agent/market/ohlc",
            {
              symbol,
              interval,
              market: a.market,
              source,
              limit: 120,
            },
            source === "ea" ? 30000 : undefined,
          ) as Promise<{ candles?: unknown[] }>;
        const preferEa = layoutSource === "ea";
        let ohlc = await fetchCandles(preferEa ? "ea" : undefined).catch(
          () => null as { candles?: unknown[] } | null,
        );
        if (!ohlc?.candles?.length && a.market !== "crypto") {
          // Whichever source failed, try the other (EA offline ↔ OANDA
          // doesn't know broker-suffixed symbols).
          const alt = await fetchCandles(preferEa ? "oanda" : "ea").catch(
            () => null,
          );
          if (alt?.candles?.length) ohlc = alt;
        }
        if (!ohlc) ohlc = { candles: [] };
        return {
          live_chart: true,
          symbol,
          interval,
          layout_id: layout?.id ?? null,
          url: layout?.url ?? null,
          ohlc,
          state: layout?.state ?? null,
          at: new Date().toISOString(),
        };
      }, { structured: true });
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
