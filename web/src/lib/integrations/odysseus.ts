import { getPublicAppUrl } from "@/lib/appUrl";

export type OdysseusTradingModeAlias = "manual" | "semi_auto" | "full_auto";

export type OdysseusTradingModeMapping = {
  alias: OdysseusTradingModeAlias;
  aichartMode: "direct" | "approval" | "auto";
  description: string;
};

export interface OdysseusToolDescriptor {
  name: string;
  description: string;
  bridgePath: string;
  method: "GET" | "POST" | "PATCH";
  readOnly: boolean;
}

export interface OdysseusIntegrationManifest {
  version: string;
  integration: "odysseus";
  host: "aichart";
  baseUrl: string;
  capabilities: Record<string, boolean | string>;
  tradingModes: OdysseusTradingModeMapping[];
  tools: OdysseusToolDescriptor[];
  endpoints: {
    manifest: string;
    embed: string;
    embedToken: string;
    klines: string;
    instruments: string;
    agentPrefix: string;
  };
}

const TRADING_MODES: OdysseusTradingModeMapping[] = [
  {
    alias: "manual",
    aichartMode: "direct",
    description: "Analysis and recommendations only — no trade execution.",
  },
  {
    alias: "semi_auto",
    aichartMode: "approval",
    description: "Agent prepares trades; user confirms Execute in chat.",
  },
  {
    alias: "full_auto",
    aichartMode: "auto",
    description: "Agent may execute via Risk Guard when enabled by the user.",
  },
];

export function buildOdysseusToolDescriptors(): OdysseusToolDescriptor[] {
  const prefix = "/api/agent";
  return [
    {
      name: "open_chart",
      description: "Open an embedded TradingView chart inside the Odysseus chat.",
      bridgePath: `${prefix}/chart/layout`,
      method: "GET",
      readOnly: true,
    },
    {
      name: "get_oanda_instruments",
      description: "List forex instruments available from OANDA demo data.",
      bridgePath: "/api/instruments",
      method: "GET",
      readOnly: true,
    },
    {
      name: "get_candles",
      description: "Fetch OHLC candles (OANDA or EA source).",
      bridgePath: `${prefix}/market/ohlc`,
      method: "GET",
      readOnly: true,
    },
    {
      name: "analyze_market",
      description: "Run structured market analysis with drawings and recommendation.",
      bridgePath: `${prefix}/market/analyze`,
      method: "POST",
      readOnly: true,
    },
    {
      name: "create_recommendation",
      description: "Record a trade recommendation before execution.",
      bridgePath: `${prefix}/recommendation`,
      method: "POST",
      readOnly: false,
    },
    {
      name: "execute_mt5_order",
      description: "Execute a trade on MetaTrader via EA bridge (Risk Guard gated).",
      bridgePath: `${prefix}/trade/open`,
      method: "POST",
      readOnly: false,
    },
    {
      name: "emergency_stop",
      description: "Enable kill switch — block new trades platform-wide for the user.",
      bridgePath: `${prefix}/risk/kill-switch`,
      method: "POST",
      readOnly: false,
    },
    {
      name: "get_mt5_status",
      description: "EA online state, live quotes freshness, bridge diagnostics.",
      bridgePath: `${prefix}/ea/diagnostics`,
      method: "GET",
      readOnly: true,
    },
    {
      name: "get_risk_settings",
      description: "Risk limits, mode, daily loss, open trades count.",
      bridgePath: `${prefix}/risk/status`,
      method: "GET",
      readOnly: true,
    },
    {
      name: "set_trading_mode",
      description: "Set execution authority: direct / approval / auto.",
      bridgePath: `${prefix}/mode`,
      method: "POST",
      readOnly: false,
    },
  ];
}

export function buildOdysseusManifest(
  baseUrl = getPublicAppUrl(),
): OdysseusIntegrationManifest {
  const root = baseUrl.replace(/\/$/, "");
  return {
    version: "1.0.0",
    integration: "odysseus",
    host: "aichart",
    baseUrl: root,
    capabilities: {
      chatEmbeddedChart: true,
      oandaServerSideMarketData: true,
      tradingViewAdvancedChartingLibrary: true,
      mt5EaExecutionBridge: true,
      visionForReportsOnly: true,
      agentDrawings: true,
      userDrawingsSeparate: true,
      internalBacktesting: "planned",
      replayMode: "planned",
      multiSymbolCompare: "planned",
    },
    tradingModes: TRADING_MODES,
    tools: buildOdysseusToolDescriptors(),
    endpoints: {
      manifest: `${root}/api/integrations/odysseus/manifest`,
      embed: `${root}/integrations/odysseus/embed`,
      embedToken: `${root}/api/integrations/odysseus/embed-token`,
      klines: `${root}/api/market/klines`,
      instruments: `${root}/api/instruments`,
      agentPrefix: `${root}/api/agent`,
    },
  };
}

export function buildOdysseusEmbedUrl(params: {
  symbol?: string;
  interval?: string;
  source?: "oanda" | "ea";
  sessionId?: string;
  layoutId?: string;
  recommendationId?: string | number;
  token?: string;
  baseUrl?: string;
  readonlyAgentDrawings?: boolean;
}): string {
  const root = (params.baseUrl ?? getPublicAppUrl()).replace(/\/$/, "");
  const q = new URLSearchParams();
  if (params.symbol) q.set("symbol", params.symbol.toUpperCase());
  if (params.interval) q.set("interval", params.interval);
  if (params.source) q.set("source", params.source);
  if (params.sessionId) q.set("sessionId", params.sessionId);
  if (params.layoutId) q.set("layoutId", params.layoutId);
  if (params.recommendationId != null) {
    q.set("recommendationId", String(params.recommendationId));
  }
  if (params.token) q.set("token", params.token);
  if (params.readonlyAgentDrawings) q.set("readonlyAgentDrawings", "1");
  const qs = q.toString();
  return `${root}/integrations/odysseus/embed${qs ? `?${qs}` : ""}`;
}

export function sanitizeOdysseusSymbol(raw: string | null | undefined): string {
  const s = (raw ?? "EURUSD").toUpperCase().replace(/[^A-Z0-9._]/g, "");
  return s.length >= 6 ? s.slice(0, 12) : "EURUSD";
}

export function sanitizeOdysseusInterval(raw: string | null | undefined): string {
  const allowed = new Set([
    "1m",
    "3m",
    "5m",
    "15m",
    "30m",
    "1h",
    "2h",
    "4h",
    "1d",
    "1w",
  ]);
  const iv = (raw ?? "15m").toLowerCase();
  return allowed.has(iv) ? iv : "15m";
}

export function sanitizeOdysseusSource(
  raw: string | null | undefined,
): "oanda" | "ea" {
  return raw === "ea" ? "ea" : "oanda";
}
