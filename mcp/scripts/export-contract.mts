#!/usr/bin/env node
/**
 * Export the CANONICAL TOOL CONTRACT to agent/tools/contract.json.
 *
 * One contract describes every production tool across surfaces:
 *   - mcp:  registered MCP tools (derived from TOOL_CATALOG — single source)
 *   - web:  the in-app expert agent TOOLS loop (web/src/lib/agent.ts)
 *   - research: policy allowlist names used by the Research Swarm
 *
 * Fields: name, version, description, permission, riskClass, surfaces,
 * executor, idempotent, cancellation, timeoutMs, telemetry, aliases,
 * requiredFeatureFlags, inputSchemaRef. Web/MCP/research parity tests
 * validate their catalogues against this file.
 *
 * Usage: tsx scripts/export-contract.mts [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_SERVER_VERSION } from "../src/tools/registry.js";
import { TOOL_CATALOG } from "../src/tools/schemas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, "..", "..", "agent", "tools", "contract.json");
const checkMode = process.argv.includes("--check");

type Permission =
  | "market.read" | "chart.read" | "chart.write" | "account.read"
  | "recommendation.read" | "recommendation.write" | "trade.recommend"
  | "trade.execute" | "trade.manage" | "memory.read" | "memory.write"
  | "settings.write" | "notify.send" | "research.run" | "ui.render" | "web.browse";
type RiskClass = "read" | "write" | "recommendation" | "execution";

interface Override {
  permission: Permission;
  riskClass?: RiskClass;
  aliases?: string[];
  requiredFeatureFlags?: string[];
  timeoutMs?: number;
}

/**
 * Explicit permission/risk assignments. Anything not listed defaults from
 * annotations: read-only → market.read/read; destructive → settings.write/write.
 * High-risk execution tools MUST be listed here so the risk class is explicit.
 */
const OVERRIDES: Record<string, Override> = {
  // — execution (server-controlled; Risk Guard + explicit approval) —
  open_trade: { permission: "trade.execute", riskClass: "execution", timeoutMs: 60_000 },
  close_trade: { permission: "trade.execute", riskClass: "execution", timeoutMs: 60_000 },
  close_partial: { permission: "trade.execute", riskClass: "execution", timeoutMs: 60_000 },
  open_pending_order: { permission: "trade.execute", riskClass: "execution", timeoutMs: 60_000 },
  cancel_mt5_order: { permission: "trade.manage", riskClass: "execution", timeoutMs: 60_000 },
  modify_sl_tp: { permission: "trade.manage", riskClass: "execution", timeoutMs: 60_000 },
  respond_approval: { permission: "trade.execute", riskClass: "execution" },
  run_trade_maintenance: { permission: "trade.manage", riskClass: "execution" },
  // — recommendation —
  create_recommendation: {
    permission: "trade.recommend",
    riskClass: "recommendation",
    aliases: ["record_recommendation"],
  },
  request_approval: { permission: "trade.recommend", riskClass: "recommendation" },
  record_exit_decision: { permission: "trade.manage", riskClass: "recommendation" },
  // — account / market reads —
  get_account_overview: { permission: "account.read" },
  get_portfolio: { permission: "account.read" },
  get_risk_status: { permission: "account.read" },
  get_open_trades: { permission: "account.read" },
  get_trade_readiness: { permission: "account.read" },
  get_pending_approvals: { permission: "account.read" },
  get_execution_env: { permission: "account.read" },
  get_agent_settings: { permission: "account.read" },
  get_agent_capabilities: { permission: "account.read" },
  get_live_account: { permission: "account.read" },
  get_mt5_status: { permission: "account.read" },
  get_ea_diagnostics: { permission: "account.read" },
  get_ea_live_quotes: { permission: "market.read" },
  get_account_symbols: { permission: "market.read" },
  get_trading_style: { permission: "account.read" },
  evaluate_trade: { permission: "account.read" },
  get_trade_lessons: { permission: "memory.read" },
  get_market_price: { permission: "market.read", aliases: ["get_price"] },
  // — settings writes —
  set_trading_mode: { permission: "settings.write", riskClass: "write" },
  set_active_market: { permission: "settings.write", riskClass: "write" },
  set_trading_style: { permission: "settings.write", riskClass: "write" },
  set_futures_enabled: { permission: "settings.write", riskClass: "write" },
  set_execution_env: { permission: "settings.write", riskClass: "execution" },
  connect_mt5: { permission: "settings.write", riskClass: "write" },
  disconnect_mt5: { permission: "settings.write", riskClass: "write" },
  request_ea_reconnect: { permission: "settings.write", riskClass: "write" },
  query_mt5_terminal: { permission: "account.read", riskClass: "read" },
  send_telegram_menu: { permission: "notify.send", riskClass: "write" },
  // — charts —
  list_chart_layouts: { permission: "chart.read" },
  get_chart_state: { permission: "chart.read" },
  get_chart_link: { permission: "chart.read" },
  get_recommendation_chart: { permission: "chart.read" },
  capture_chart_snapshot: { permission: "chart.read" },
  capture_mt5_chart: { permission: "chart.read" },
  show_live_chart: { permission: "chart.read" },
  draw_on_chart: { permission: "chart.write", riskClass: "write" },
  clear_chart_drawings: { permission: "chart.write", riskClass: "write" },
  run_market_analysis: {
    permission: "market.read",
    requiredFeatureFlags: ["FEATURE_SMART_CHART_AGENT"],
    timeoutMs: 120_000,
  },
  // — skills —
  list_agent_skills: { permission: "memory.read" },
  load_agent_skill: { permission: "memory.read" },
};

/** Web-only tools (in-app expert loop) not present in the MCP catalogue. */
const WEB_ONLY_TOOLS: Array<{
  name: string;
  description: string;
  permission: Permission;
  riskClass: RiskClass;
  executor: string;
  aliases?: string[];
}> = [
  { name: "resolve_symbol", description: "Resolve a user symbol/name to a canonical trading symbol.", permission: "market.read", riskClass: "read", executor: "web-local" },
  { name: "get_market_snapshot", description: "(shared with MCP)", permission: "market.read", riskClass: "read", executor: "web-local" },
  { name: "get_user_profile", description: "Read the user's trading settings and profile.", permission: "account.read", riskClass: "read", executor: "web-local" },
  { name: "get_trades_summary", description: "Summarize the user's trade history.", permission: "account.read", riskClass: "read", executor: "web-local" },
  { name: "get_recommendations_history", description: "List past recommendations.", permission: "recommendation.read", riskClass: "read", executor: "web-local" },
  { name: "search_trade_memory", description: "Semantic search over trade lessons/memory.", permission: "memory.read", riskClass: "read", executor: "web-local" },
  { name: "get_cards_guide", description: "Card catalogue guidance for render_cards.", permission: "ui.render", riskClass: "read", executor: "web-local" },
  { name: "render_cards", description: "Render interactive UI cards in web chat.", permission: "ui.render", riskClass: "write", executor: "web-local" },
  { name: "set_risk_guard", description: "Toggle Risk Guard enforcement (server re-validates).", permission: "settings.write", riskClass: "write", executor: "web-bridge" },
  { name: "browse_web", description: "Fetch/screenshot an external web page (Playwright).", permission: "web.browse", riskClass: "read", executor: "web-local" },
];

/** Research Swarm policy allowlist names → canonical mapping. */
const RESEARCH_TOOLS: Array<{ name: string; canonical: string | null }> = [
  { name: "market_snapshot", canonical: "get_market_snapshot" },
  { name: "multi_timeframe_snapshot", canonical: "get_multi_timeframe_snapshot" },
  { name: "active_recommendation_read", canonical: null },
  { name: "trade_lessons_read", canonical: "get_trade_lessons" },
  { name: "trading_dna_read", canonical: null },
  { name: "shadow_recommendation_read", canonical: null },
  { name: "run_forex_backtest", canonical: null },
  { name: "run_backtest_validation", canonical: null },
  { name: "get_research_artifacts", canonical: null },
  { name: "recommendation_analytics_read", canonical: null },
];

function riskFromAnnotations(name: string): RiskClass {
  const def = TOOL_CATALOG.find((t) => t.name === name)!;
  if (def.annotations.readOnlyHint) return "read";
  return "write";
}

function buildContract() {
  const tools = TOOL_CATALOG.map((def) => {
    const override = OVERRIDES[def.name];
    const riskClass: RiskClass = override?.riskClass ?? riskFromAnnotations(def.name);
    const surfaces = ["mcp"];
    const webShared = new Set([
      "get_market_snapshot", "get_market_context", "get_account_overview",
      "get_risk_status", "get_open_trades", "get_account_symbols",
      "get_multi_timeframe_snapshot", "scan_market", "get_trade_readiness",
      "open_trade", "close_trade", "modify_sl_tp", "request_approval",
      "set_trading_mode", "set_active_market", "set_trading_style",
    ]);
    if (webShared.has(def.name) || OVERRIDES[def.name]?.aliases?.length) surfaces.push("web");
    return {
      name: def.name,
      version: MCP_SERVER_VERSION,
      description: def.description,
      permission: override?.permission ?? "market.read",
      riskClass,
      surfaces,
      executor: "web-api-bridge",
      serverControlled: true,
      idempotent: def.annotations.idempotentHint === true,
      cancellation: "http-abort",
      timeoutMs: override?.timeoutMs ?? 30_000,
      telemetry: "server-audit-log",
      inputSchemaRef: `mcp/schemas/tools/${def.name}.json`,
      outputValidation: "bridge-envelope",
      aliases: override?.aliases ?? [],
      requiredFeatureFlags: override?.requiredFeatureFlags ?? [],
    };
  });

  for (const tool of WEB_ONLY_TOOLS) {
    if (tools.some((t) => t.name === tool.name)) continue;
    tools.push({
      name: tool.name,
      version: MCP_SERVER_VERSION,
      description: tool.description,
      permission: tool.permission,
      riskClass: tool.riskClass,
      surfaces: ["web"],
      executor: tool.executor,
      serverControlled: true,
      idempotent: tool.riskClass === "read",
      cancellation: "http-abort",
      timeoutMs: 30_000,
      telemetry: "server-audit-log",
      inputSchemaRef: "web/src/lib/agent.ts#TOOLS",
      outputValidation: "handler-json",
      aliases: [],
      requiredFeatureFlags: [],
    });
  }

  tools.sort((a, b) => a.name.localeCompare(b.name));

  return {
    contractVersion: MCP_SERVER_VERSION,
    description:
      "Canonical AiChart tool contract. Web, MCP, and research surfaces are validated against this file — permissions and execution authority remain server-controlled regardless of what any model or client requests.",
    highRiskPolicy:
      "riskClass=execution tools always route through the web API (Risk Guard + explicit approval + tenant auth + idempotency). No skill, prompt, memory, or MCP client can grant execution authority.",
    tools,
    research: {
      description:
        "Research Swarm role allowlist names (policy-level, isolated from execution).",
      tools: RESEARCH_TOOLS,
    },
  };
}

const next = `${JSON.stringify(buildContract(), null, 2)}\n`;

if (checkMode) {
  let current = "";
  try {
    current = readFileSync(CONTRACT_PATH, "utf8");
  } catch {
    console.error("contract.json missing — run npm run contract:export");
    process.exit(1);
  }
  if (current !== next) {
    console.error("contract.json drift — run npm run contract:export");
    process.exit(1);
  }
  console.log("contract:check OK");
} else {
  writeFileSync(CONTRACT_PATH, next, "utf8");
  console.log(`Exported canonical tool contract → ${CONTRACT_PATH}`);
}
