import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeClient } from "../bridge/client.js";
import { bridgeCall, bridgeWrap } from "./helpers.js";

export function registerBinanceTools(server: McpServer, bridge: BridgeClient) {
  server.registerTool(
    "connect_binance",
    {
      description:
        "ربط Binance API Key + Secret (testnet أو prod). يتحقق من canTrade وصلاحيات Futures.",
      inputSchema: {
        apiKey: z.string().min(10),
        apiSecret: z.string().min(10),
        env: z.enum(["testnet", "prod"]).optional(),
        label: z.string().max(60).optional(),
        futuresRequired: z.boolean().optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/binance/connect", body)),
  );

  server.registerTool(
    "verify_binance",
    {
      description: "التحقق من مفتاح Binance دون حفظ (verify_only).",
      inputSchema: {
        apiKey: z.string().min(10),
        apiSecret: z.string().min(10),
        env: z.enum(["testnet", "prod"]).optional(),
        futuresRequired: z.boolean().optional(),
      },
    },
    async (body) =>
      bridgeCall(() =>
        bridge.post("/api/agent/binance/connect", {
          ...body,
          verify_only: true,
        }),
      ),
  );

  server.registerTool(
    "get_binance_status",
    {
      description: "حالة مفتاح Binance المرتبط + permissionReport.",
      inputSchema: {
        futuresRequired: z.boolean().optional(),
      },
    },
    async ({ futuresRequired }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/binance/connect", {
          futuresRequired: futuresRequired ? "1" : undefined,
        }),
      ),
  );

  server.registerTool(
    "disconnect_binance",
    {
      description: "فصل Binance — env اختياري (testnet|prod) أو الكل.",
      inputSchema: {
        env: z.enum(["testnet", "prod"]).optional(),
      },
    },
    async ({ env }) => {
      const query = env ? `?env=${env}` : "";
      return bridgeCall(() => bridge.delete(`/api/agent/binance${query}`));
    },
  );

  server.registerTool(
    "capture_binance_chart",
    {
      description:
        "لقطة شارت Binance (Playwright أو fallback). يرجع chart_url_telegram + image_base64.",
      inputSchema: {
        symbol: z.string(),
        interval: z.string().optional(),
        market_type: z.enum(["spot", "futures"]).optional(),
        full_page: z.boolean().optional(),
        chart_drawings: z.array(z.record(z.string(), z.unknown())).optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/chart/binance-capture", body)),
  );

  server.registerTool(
    "get_futures_positions",
    {
      description: "مراكز Binance Futures USDT-M المفتوحة.",
      inputSchema: {
        symbol: z.string().optional(),
      },
    },
    async ({ symbol }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/futures/positions", symbol ? { symbol } : {}),
      ),
  );

  server.registerTool(
    "get_futures_orders",
    {
      description: "أوامر Binance Futures المعلّقة.",
      inputSchema: {
        symbol: z.string().optional(),
      },
    },
    async ({ symbol }) =>
      bridgeCall(() =>
        bridge.get("/api/agent/futures/orders", symbol ? { symbol } : {}),
      ),
  );

  server.registerTool(
    "modify_futures_sl_tp",
    {
      description: "تعديل SL/TP على مركز Binance Futures مفتوح.",
      inputSchema: {
        symbol: z.string(),
        stop_loss: z.number().positive().nullish(),
        take_profit: z.number().positive().nullish(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.post("/api/agent/futures/modify", body)),
  );

  server.registerTool(
    "cancel_futures_order",
    {
      description: "إلغاء أمر Binance Futures (order_id أو all لرمز).",
      inputSchema: {
        symbol: z.string(),
        order_id: z.number().int().positive().optional(),
        all: z.boolean().optional(),
      },
    },
    async (body) =>
      bridgeCall(() => bridge.delete("/api/agent/futures/orders", body)),
  );
}
