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
import { wildcardPath } from "./http/wildcardPath.js";
import { logPublicWidgetFetch, widgetHtmlByPublicPath } from "./ui/index.js";
import { STATIC_ASSETS } from "./ui/runtime.js";
import { normalizeWidgetPublicPath } from "./ui/publicPath.js";
import { PORTFOLIO_ASSETS } from "./ui/widgets.js";

const MCP_UI_ASSETS = [
  ...Object.values(STATIC_ASSETS),
  ...Object.values(PORTFOLIO_ASSETS),
];

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
  const path = normalizeWidgetPublicPath(
    wildcardPath(req.params as Record<string, unknown>),
  );

  const asset = MCP_UI_ASSETS.find((a) => a.path === path);
  if (asset) {
    logPublicWidgetFetch(path, true, asset.body.length);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Content-Type", asset.mimeType);
    res.removeHeader("X-Frame-Options");
    res.send(asset.body);
    return;
  }

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

// In-memory session registry. Sessions die with the process (deploys, pm2
// restarts) — per MCP spec an unknown/terminated session id MUST get HTTP 404
// so the client transparently re-initializes; 400 makes hosts surface
// "Failed to fetch app content" instead of recovering.
const transports: Record<string, StreamableHTTPServerTransport> = {};
const sessionLastSeen: Record<string, number> = {};

const SESSION_IDLE_TTL_MS = Number(
  process.env.MCP_SESSION_IDLE_TTL_MS ?? 45 * 60 * 1000,
);
const SESSION_MAX = Number(process.env.MCP_SESSION_MAX ?? 400);

function touchSession(sid: string): void {
  sessionLastSeen[sid] = Date.now();
}

function dropSession(sid: string): void {
  const t = transports[sid];
  delete transports[sid];
  delete sessionLastSeen[sid];
  if (t) void t.close().catch(() => {});
}

/** Evict idle sessions (and oldest beyond the cap) so memory stays flat. */
function sweepSessions(): void {
  const now = Date.now();
  for (const sid of Object.keys(transports)) {
    if (now - (sessionLastSeen[sid] ?? 0) > SESSION_IDLE_TTL_MS) {
      dropSession(sid);
    }
  }
  const ids = Object.keys(transports);
  if (ids.length > SESSION_MAX) {
    ids
      .sort((a, b) => (sessionLastSeen[a] ?? 0) - (sessionLastSeen[b] ?? 0))
      .slice(0, ids.length - SESSION_MAX)
      .forEach(dropSession);
  }
}
setInterval(sweepSessions, 5 * 60 * 1000).unref();

/** Spec-compliant rejection: 404 tells the client to start a new session. */
function respondSessionNotFound(res: import("express").Response): void {
  res.status(404).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Session not found — please reinitialize" },
    id: null,
  });
}

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
      touchSession(sessionId);
    } else if (isInitializeRequest(req.body)) {
      // Fresh session — also accepted when the client retries initialize
      // while still sending a stale session id after a server restart.
      const userBridge = await bridgeForRequest(req);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
          touchSession(sid);
        },
      });
      transport.onclose = () => {
        const sid = transport!.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
          delete sessionLastSeen[sid];
        }
      };
      const server = createAiChartMcpServer(userBridge);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else if (sessionId) {
      // Known-format request on a dead session (server restarted / evicted):
      // MCP spec mandates 404 so the client re-initializes automatically.
      respondSessionNotFound(res);
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
  if (!sessionId) {
    res.status(400).send("Missing session ID");
    return;
  }
  if (!transports[sessionId]) {
    respondSessionNotFound(res);
    return;
  }
  touchSession(sessionId);
  await transports[sessionId].handleRequest(req, res);
};

const mcpDeleteHandler = async (
  req: import("express").Request,
  res: import("express").Response,
) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    res.status(400).send("Missing session ID");
    return;
  }
  if (!transports[sessionId]) {
    respondSessionNotFound(res);
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
