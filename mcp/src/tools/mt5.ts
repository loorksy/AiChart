import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { bridgeCall, bridgeWrap } from "./helpers.js";

export function registerMt5Tools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "connect_mt5",
    {
      description:
        "ربط MetaTrader (MetaApi/mt5local): platform + server + login + password. لا يعمل مع FOREX_BACKEND=ea.",
      inputSchema: {
        platform: z.enum(["mt4", "mt5"]),
        server: z.string().min(2),
        login: z.string().min(1),
        password: z.string().min(1),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/mt/connect", body)),
  );

  server.registerTool(
    "disconnect_mt5",
    {
      description: "فصل حساب MetaTrader (MetaApi/mt5local).",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.delete("/api/agent/mt/connect")),
  );

  server.registerTool(
    "get_mt5_status",
    {
      description: "حالة اتصال MetaApi/mt5local: online، balance، server.",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.get("/api/agent/mt/status")),
  );

  server.registerTool(
    "get_live_account",
    {
      description:
        "بث مباشر موحّد: MT5 quotes + مراكز + Binance futures + quoteAgeMs. استدعِه قبل أي صفقة أو تحليل.",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.get("/api/agent/live/account")),
  );

  server.registerTool(
    "get_ea_diagnostics",
    {
      description: "تشخيص EA: رموز heartbeat، quotesOk، spread، retcode legend.",
      inputSchema: {
        symbol: z.string().optional(),
      },
    },
    async ({ symbol }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/ea/diagnostics", symbol ? { symbol } : {}),
      ),
  );

  server.registerTool(
    "get_ea_live_quotes",
    {
      description: "أسعار MT5 live من EA v3 مع quoteAgeMs.",
      inputSchema: {
        symbol: z.string().optional(),
      },
    },
    async ({ symbol }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/ea/live-quotes", symbol ? { symbol } : {}),
      ),
  );

  server.registerTool(
    "capture_mt5_chart",
    {
      description: "رسم على شارت MT5 + screenshot (draw_and_capture). يتطلب EA v3.",
      inputSchema: {
        symbol: z.string(),
        interval: z.string().optional(),
        recommendation_id: z.number().int().positive().optional(),
        capture_key: z.string().optional(),
        entry: z.number().optional(),
        stop_loss: z.number().optional(),
        take_profit: z.number().optional(),
        drawings: z.array(z.record(z.string(), z.unknown())).optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/ea/chart-capture", body)),
  );

  server.registerTool(
    "modify_sl_tp",
    {
      description: "تعديل وقف خسارة/جني ربح على مركز MT5 مفتوح (EA).",
      inputSchema: {
        ticket: z.number().int().positive(),
        stop_loss: z.number().positive(),
        take_profit: z.number().positive().optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/ea/modify-sl-tp", body)),
  );

  server.registerTool(
    "open_pending_order",
    {
      description: "أمر معلّق MT5: limit | stop | stop_limit (EA v3).",
      inputSchema: {
        symbol: z.string(),
        side: z.enum(["buy", "sell"]),
        order_type: z.enum(["limit", "stop", "stop_limit"]),
        lots: z.number().positive(),
        price: z.number().positive(),
        stop_loss: z.number().positive().optional(),
        take_profit: z.number().positive().optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/ea/pending-order", body)),
  );

  server.registerTool(
    "cancel_mt5_order",
    {
      description: "إلغاء أمر معلّق MT5 بالتذكرة (EA).",
      inputSchema: {
        ticket: z.number().int().positive(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/ea/cancel-order", body)),
  );

  server.registerTool(
    "close_partial",
    {
      description: "إغلاق جزئي لمركز MT5 (EA).",
      inputSchema: {
        ticket: z.number().int().positive(),
        lots: z.number().positive(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/ea/close-partial", body)),
  );

  server.registerTool(
    "query_mt5_terminal",
    {
      description: "لقطة MT5: margin، أوامر معلّقة، equity (EA).",
      inputSchema: {},
    },
    bridgeWrap(bridge, () => bridge.get("/api/agent/ea/query-terminal")),
  );
}
