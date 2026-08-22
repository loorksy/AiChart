/**
 * Chart-host capability token.
 *
 * The headless chart session (a Playwright-hosted tab in its own Docker
 * container) opens ONE internal page — /chart-host — and that page polls the
 * capture RPC. Neither carries a browser session; both authenticate with this
 * HMAC token, minted server-side and passed in the page URL the app itself
 * hands to the container. Same secret family as the MCP embed capability URL.
 *
 * Deliberately its own kind (`chart-host`), never interchangeable with the
 * embed token: an embed token in the host RPC (or vice versa) verifies to
 * null, so a leaked viewer URL can never operate the platform tab.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SEC = 48 * 60 * 60;

export interface ChartHostClaims {
  v: 1;
  kind: "chart-host";
  exp: number;
}

function hostSecret(): string | null {
  const service = process.env.AICHART_SERVICE_TOKEN?.trim().replace(/\r$/, "");
  if (service && service.length >= 16) return service;
  const app = process.env.APP_SECRET?.trim().replace(/\r$/, "");
  if (app && app.length >= 16) return app;
  return null;
}

export function isChartHostSigningConfigured(): boolean {
  return hostSecret() !== null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`chart-host:${payload}`).digest("base64url");
}

function equalSig(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function mintChartHostToken(input: { ttlSec?: number; nowSec?: number } = {}): string {
  const secret = hostSecret();
  if (!secret) throw new Error("chart-host signing is not configured");
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const ttl = input.ttlSec && input.ttlSec > 0 ? input.ttlSec : DEFAULT_TTL_SEC;
  const claims: ChartHostClaims = { v: 1, kind: "chart-host", exp: nowSec + ttl };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyChartHostToken(
  token: string | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): ChartHostClaims | null {
  if (!token) return null;
  const secret = hostSecret();
  if (!secret) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!equalSig(sign(parts[0], secret), parts[1])) return null;
  let claims: ChartHostClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as ChartHostClaims;
  } catch {
    return null;
  }
  if (claims.v !== 1 || claims.kind !== "chart-host") return null;
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSec) return null;
  return claims;
}
