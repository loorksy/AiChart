import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import express from "express";
import {
  createOAuthMetadata,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { BridgeClient } from "./bridge/client.js";
import { AiChartOAuthProvider } from "./auth/provider.js";
import { ensureMcpAuthTables } from "./auth/db.js";
import { mountLoginRoutes } from "./auth/login.js";
import { loadConfig } from "./config.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createAiChartMcpServer } from "./server/mcpServer.js";
import { logPublicWidgetFetch, widgetHtmlByPublicPath } from "./ui/index.js";

const cfg = loadConfig();
const mcpServerUrl = cfg.publicUrl;
const issuerUrl = new URL(mcpServerUrl.origin);

const app = createMcpExpressApp({
  host: "0.0.0.0",
  allowedHosts:
    cfg.allowedHosts.length > 0
      ? cfg.allowedHosts
      : ["localhost", "127.0.0.1", mcpServerUrl.hostname],
});

app.set("trust proxy", 1);

app.use(cookieParser());
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "aichart-mcp",
    authMode: cfg.authMode,
    mcpUrl: mcpServerUrl.href,
  });
});

/** Static MCP App templates — no auth; hosts may fetch markup outside the MCP session. */
app.options("/mcp-ui/{*path}", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.status(204).end();
});

app.get("/mcp-ui/{*path}", (req, res) => {
  const path = String(req.params.path ?? "");
  const hit = widgetHtmlByPublicPath(path);
  logPublicWidgetFetch(path, Boolean(hit), hit?.html.length);
  if (!hit) {
    res.status(404).json({ error: "Unknown widget template", path });
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.setHeader("Content-Type", hit.mimeType || RESOURCE_MIME_TYPE);
  res.removeHeader("X-Frame-Options");
  res.send(hit.html);
});

let authMiddleware: ReturnType<typeof requireBearerAuth> | null = null;
let oauthProvider: AiChartOAuthProvider | null = null;

if (cfg.authMode === "oauth") {
  oauthProvider = new AiChartOAuthProvider(cfg);
  mountLoginRoutes(app, oauthProvider);

  // CORS for OAuth discovery + DCR: ChatGPT/Claude clients fetch metadata and
  // POST /register (and some flows /token) cross-origin. /mcp itself is spared.
  app.use((req, res, next) => {
    const p = req.path;
    if (p.startsWith("/.well-known/") || p === "/register" || p === "/token") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, mcp-protocol-version",
      );
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl,
      baseUrl: issuerUrl,
      scopesSupported: ["mcp:tools"],
      resourceName: "AiChart Trading MCP",
      resourceServerUrl: mcpServerUrl,
    }),
  );

  const oauthMetadata = createOAuthMetadata({
    provider: oauthProvider,
    issuerUrl,
    baseUrl: issuerUrl,
    scopesSupported: ["mcp:tools"],
  });
  oauthMetadata.introspection_endpoint = new URL(
    "/oauth/introspect",
    issuerUrl,
  ).href;

  app.post("/oauth/introspect", async (req, res) => {
    try {
      const token = String(req.body?.token ?? "");
      if (!token) {
        res.status(400).json({ error: "token required" });
        return;
      }
      const info = await oauthProvider!.verifyAccessToken(token);
      res.json({
        active: true,
        client_id: info.clientId,
        scope: info.scopes.join(" "),
        exp: info.expiresAt,
        aud: info.resource?.href,
      });
    } catch {
      res.status(401).json({ active: false });
    }
  });

  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: mcpServerUrl,
      scopesSupported: ["mcp:tools"],
      resourceName: "AiChart Trading MCP",
    }),
  );

  const tokenVerifier = {
    verifyAccessToken: async (token: string) =>
      oauthProvider!.verifyAccessToken(token),
  };

  authMiddleware = requireBearerAuth({
    verifier: tokenVerifier,
    requiredScopes: [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
  });
}

const transports: Record<string, StreamableHTTPServerTransport> = {};

async function bridgeForRequest(
  req: import("express").Request,
): Promise<BridgeClient> {
  if (cfg.authMode === "oauth") {
    const authHeader = req.headers.authorization;
    const token = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : null;
    if (!token || !oauthProvider) {
      throw new Error("Missing OAuth bearer token for bridge session.");
    }
    const authInfo = await oauthProvider.verifyAccessToken(token);
    return BridgeClient.fromAuthInfo(cfg, authInfo);
  }
  const email = process.env.AICHART_AGENT_USER_EMAIL?.trim();
  if (!email) {
    throw new Error(
      "Set AICHART_AGENT_USER_EMAIL when MCP_AUTH_MODE is not oauth.",
    );
  }
  return BridgeClient.forUser(cfg, email);
}

const mcpPostHandler = async (
  req: import("express").Request,
  res: import("express").Response,
) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const userBridge = await bridgeForRequest(req);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
        },
      });
      transport.onclose = () => {
        const sid = transport!.sessionId;
        if (sid && transports[sid]) delete transports[sid];
      };
      const server = createAiChartMcpServer(userBridge);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[mcp] POST error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
};

const mcpGetHandler = async (
  req: import("express").Request,
  res: import("express").Response,
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
};

const mcpDeleteHandler = async (
  req: import("express").Request,
  res: import("express").Response,
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
};

if (authMiddleware) {
  app.post("/mcp", authMiddleware, mcpPostHandler);
  app.get("/mcp", authMiddleware, mcpGetHandler);
  app.delete("/mcp", authMiddleware, mcpDeleteHandler);
} else {
  app.post("/mcp", mcpPostHandler);
  app.get("/mcp", mcpGetHandler);
  app.delete("/mcp", mcpDeleteHandler);
}

app.listen(cfg.port, () => {
  console.log(
    `[aichart-mcp] listening on :${cfg.port} auth=${cfg.authMode} public=${mcpServerUrl.href}`,
  );
  if (cfg.authMode === "oauth") {
    ensureMcpAuthTables()
      .then(() => console.log("[aichart-mcp] OAuth tables ready (Postgres)."))
      .catch((e) =>
        console.error("[aichart-mcp] ensureMcpAuthTables failed:", e),
      );
  }
});

process.on("SIGINT", async () => {
  for (const sid of Object.keys(transports)) {
    await transports[sid]?.close().catch(() => {});
    delete transports[sid];
  }
  process.exit(0);
});
