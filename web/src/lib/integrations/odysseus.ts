import { getPublicAppUrl } from "@/lib/appUrl";

export const ODYSSEUS_INTEGRATION_VERSION = "0.1.0" as const;

export const ODYSSEUS_TRADING_MODES = ["manual", "semi_auto", "full_auto"] as const;
export type OdysseusTradingMode = (typeof ODYSSEUS_TRADING_MODES)[number];

export const ODYSSEUS_CHART_SOURCES = ["oanda", "ea"] as const;
export type OdysseusChartSource = (typeof ODYSSEUS_CHART_SOURCES)[number];

export interface OdysseusChartEmbedOptions {
  symbol?: string;
  interval?: string;
  source?: OdysseusChartSource;
  conversationId?: string;
  recommendationId?: string;
}

export interface OdysseusToolDescriptor {
  name: string;
  description: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  requiresUserSession: boolean;
}

function cleanSymbol(symbol: string | undefined): string {
  const withoutTags = (symbol ?? "EURUSD").replace(/<[^>]*>/g, "");
  const s = withoutTags.toUpperCase().replace(/[^A-Z0-9._:-]/g, "");
  return s || "EURUSD";
}

function cleanInterval(interval: string | undefined): string {
  const allowed = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"]);
  return allowed.has(interval ?? "") ? interval! : "15m";
}

export function buildOdysseusChartEmbedUrl(
  opts: OdysseusChartEmbedOptions = {},
  baseUrl = getPublicAppUrl(),
): string {
  const url = new URL("/integrations/odysseus/embed", baseUrl);
  url.searchParams.set("symbol", cleanSymbol(opts.symbol));
  url.searchParams.set("interval", cleanInterval(opts.interval));
  url.searchParams.set("source", opts.source === "ea" ? "ea" : "oanda");
  if (opts.conversationId) url.searchParams.set("conversationId", opts.conversationId);
  if (opts.recommendationId) url.searchParams.set("recommendationId", opts.recommendationId);
  return url.toString();
}

export const ODYSSEUS_TOOL_DESCRIPTORS: OdysseusToolDescriptor[] = [
  {
    name: "open_chart",
    description: "Open an embeddable TradingView Advanced Charting Library panel inside an Odysseus chat turn.",
    method: "GET",
    path: "/api/integrations/odysseus/manifest",
    requiresUserSession: false,
  },
  {
    name: "get_oanda_instruments",
    description: "List the OANDA-backed forex/metals instrument universe exposed by AiChart.",
    method: "GET",
    path: "/api/instruments?market=forex&wrapped=1",
    requiresUserSession: false,
  },
  {
    name: "get_candles",
    description: "Fetch OANDA or EA candles for the active TradingView datafeed.",
    method: "GET",
    path: "/api/market/klines?market=forex&symbol=EURUSD&interval=15m&fresh=1",
    requiresUserSession: false,
  },
  {
    name: "analyze_market",
    description: "Run AiChart's professional market analysis pipeline for a forex setup.",
    method: "POST",
    path: "/api/market/analyze",
    requiresUserSession: false,
  },
  {
    name: "create_recommendation",
    description: "Create an auditable agent recommendation with chart drawings and setup rationale.",
    method: "POST",
    path: "/api/agent/recommendation",
    requiresUserSession: true,
  },
  {
    name: "execute_mt5_order",
    description: "Send an approved recommendation to the user's MetaTrader 5 EA bridge through Risk Guard.",
    method: "POST",
    path: "/api/agent/trade/open",
    requiresUserSession: true,
  },
  {
    name: "emergency_stop",
    description: "Enable the kill switch so no new MT5 orders are accepted for the user.",
    method: "POST",
    path: "/api/agent/risk-guard",
    requiresUserSession: true,
  },
  {
    name: "get_mt5_status",
    description: "Read the current user's MT5/EA bridge readiness before any execution attempt.",
    method: "GET",
    path: "/api/agent/mt/status",
    requiresUserSession: true,
  },
  {
    name: "get_risk_settings",
    description: "Read Risk Guard settings and current risk state for the mapped AiChart user.",
    method: "GET",
    path: "/api/agent/risk/status",
    requiresUserSession: true,
  },
  {
    name: "set_trading_mode",
    description: "Map Odysseus manual/semi_auto/full_auto modes to AiChart direct/approval/auto settings.",
    method: "POST",
    path: "/api/agent/mode",
    requiresUserSession: true,
  },
];

export function buildOdysseusIntegrationManifest(baseUrl = getPublicAppUrl()) {
  return {
    name: "AiChart Trading Workspace for Odysseus",
    version: ODYSSEUS_INTEGRATION_VERSION,
    baseUrl,
    licenseNote:
      "TradingView Advanced Charting Library files require the deployer's TradingView license; Odysseus AGPL obligations must be reviewed by the deployer.",
    defaultChart: {
      symbol: "EURUSD",
      interval: "15m",
      source: "oanda" satisfies OdysseusChartSource,
      embedUrl: buildOdysseusChartEmbedUrl({ symbol: "EURUSD", interval: "15m" }, baseUrl),
    },
    capabilities: {
      chatEmbeddedChart: true,
      oandaServerSideMarketData: true,
      tradingViewAdvancedChartingLibrary: true,
      agentDrawings: true,
      visionForReportsOnly: true,
      internalBacktesting: "planned",
      mt5EaExecutionBridge: true,
      userEmergencyStop: true,
      modes: ODYSSEUS_TRADING_MODES,
    },
    surfaces: {
      chatPanel: "Render the chart as an assistant-opened panel inside the active Odysseus conversation.",
      agentAnalysis: "Show professional setup cards, drawings, and post-trade reviews.",
      riskSettings: "Reuse AiChart risk settings before enabling semi_auto/full_auto modes.",
      tradeHistory: "Reuse AiChart trade journal and MT5 sync records.",
    },
    tools: ODYSSEUS_TOOL_DESCRIPTORS,
  };
}
