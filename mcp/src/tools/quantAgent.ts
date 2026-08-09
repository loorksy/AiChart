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
 *
 * The three chat/generate-strategy handlers below additionally call
 * `/api/quant-agent/chat/*` routes owned by a sibling workstream that had
 * not landed yet when these handlers were written — see the ASSUMPTION
 * comments on each for the exact paths assumed and why, flagged for
 * reconciliation once that workstream lands.
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

  // — Quant Agent chat (a second, independent conversational assistant next
  // to Lonora's chat — see QUANT_AGENT_CHAT_DISAMBIGUATION in
  // schemas/quantAgentSchemas.ts). ASSUMPTION (integration point — reconcile
  // once web/src/app/api/quant-agent/chat/* actually lands): no existing
  // Lonora MCP tool calls a streaming SSE endpoint (grepped
  // `mcp/src/tools/` for `/api/agent/chat/stream` and similar — no
  // precedent found), so rather than have this MCP handler try to consume
  // an SSE stream itself, we call a plain non-streaming POST endpoint,
  // `/api/quant-agent/chat/message`, which the web workstream needs to
  // expose alongside its browser-facing `/api/quant-agent/chat/stream` SSE
  // route — same orchestrator, non-streaming response shape
  // (`{ chatId, reply, ... }`) collected server-side.
  server.registerTool(
    "quant_agent_chat_send",
    mcpToolConfig("quant_agent_chat_send"),
    async (args) => {
      const { chatId, message } = args as { chatId?: string; message: string };
      return bridgeCall(
        "quant_agent_chat_send",
        args as Record<string, unknown>,
        () =>
          bridge.post("/api/quant-agent/chat/message", {
            chatId: chatId?.trim() || undefined,
            message: message.trim(),
          }),
      );
    },
  );

  server.registerTool(
    "quant_agent_chat_history",
    mcpToolConfig("quant_agent_chat_history"),
    async (args) => {
      const { chatId } = args as { chatId: string };
      return bridgeCall(
        "quant_agent_chat_history",
        args as Record<string, unknown>,
        () =>
          bridge.get(
            `/api/quant-agent/chat/sessions/${encodeURIComponent(chatId.trim())}/messages`,
          ),
      );
    },
  );

  // ASSUMPTION (integration point — reconcile once the web chat workstream
  // lands): rather than reach quant_agent_generate_strategy through free-text
  // worded to trigger the orchestrator's keyword-based `generate_strategy`
  // intent on `/api/quant-agent/chat/message` (fragile for a programmatic
  // MCP caller — intent classification is meant for human chat phrasing),
  // this calls a dedicated thin proxy `/api/quant-agent/chat/generate-strategy`
  // that takes a structured `description` field directly and internally runs
  // the same generate+validate+persist-disabled path as the chat orchestrator's
  // `generate_strategy` intent (see plan §3.3 / generateAndValidateQuantStrategy
  // in web/src/lib/quantAgent/client.ts). The web-routes workstream needs to
  // add this exact route if it does not already exist.
  server.registerTool(
    "quant_agent_generate_strategy",
    mcpToolConfig("quant_agent_generate_strategy"),
    async (args) => {
      const { description } = args as { description: string };
      return bridgeCall(
        "quant_agent_generate_strategy",
        args as Record<string, unknown>,
        () =>
          bridge.post("/api/quant-agent/chat/generate-strategy", {
            description: description.trim(),
          }),
      );
    },
  );
}
