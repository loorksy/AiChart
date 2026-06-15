export type AuthMode = "oauth" | "none";

export interface AppConfig {
  port: number;
  publicUrl: URL;
  apiUrl: string;
  serviceToken: string;
  authSecret: string;
  authMode: AuthMode;
  allowedHosts: string[];
  dbPath: string;
  accessTokenTtlDays: number;
  refreshTokenTtlDays: number;
  sessionCookieMaxAgeMs: number;
}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function loadConfig(): AppConfig {
  const authMode = (process.env.MCP_AUTH_MODE ?? "oauth") as AuthMode;
  const publicUrlRaw =
    process.env.MCP_PUBLIC_URL ?? "http://127.0.0.1:8787/mcp";
  const publicUrl = new URL(publicUrlRaw);

  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (allowedHosts.length === 0 && publicUrl.hostname !== "127.0.0.1") {
    allowedHosts.push(publicUrl.hostname);
  }

  const hostname = publicUrl.hostname;
  const hosts = new Set<string>([
    ...allowedHosts,
    hostname,
    "127.0.0.1",
    "localhost",
  ]);
  if (hostname !== "127.0.0.1") {
    hosts.add(`[::1]`);
  }

  const accessTokenTtlDays = Number(
    process.env.MCP_ACCESS_TOKEN_TTL_DAYS ?? "365",
  );
  const refreshTokenTtlDays = Number(
    process.env.MCP_REFRESH_TOKEN_TTL_DAYS ??
      process.env.MCP_ACCESS_TOKEN_TTL_DAYS ??
      "365",
  );

  return {
    port: Number(process.env.MCP_PORT ?? "8787"),
    publicUrl,
    apiUrl: (process.env.AICHART_API_URL ?? "http://127.0.0.1:3000").replace(
      /\/$/,
      "",
    ),
    serviceToken:
      authMode === "none"
        ? (process.env.AICHART_SERVICE_TOKEN ?? "")
        : required("AICHART_SERVICE_TOKEN"),
    authSecret:
      authMode === "none"
        ? (process.env.MCP_AUTH_SECRET ?? "dev-only-not-for-prod")
        : required("MCP_AUTH_SECRET"),
    authMode,
    allowedHosts: [...hosts],
    dbPath: process.env.DB_PATH ?? "data/aichart.db",
    accessTokenTtlDays:
      Number.isFinite(accessTokenTtlDays) && accessTokenTtlDays > 0
        ? accessTokenTtlDays
        : 365,
    refreshTokenTtlDays:
      Number.isFinite(refreshTokenTtlDays) && refreshTokenTtlDays > 0
        ? refreshTokenTtlDays
        : 365,
    sessionCookieMaxAgeMs: 90 * 24 * 60 * 60 * 1000,
  };
}
