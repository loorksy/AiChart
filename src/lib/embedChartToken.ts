import { createHmac, timingSafeEqual } from "node:crypto";
import { getPublicAppUrl } from "./appUrl";
import { coerceToGold } from "./gold";
import { normalizeInterval } from "./intervals";

const DEFAULT_TTL_SEC = 24 * 60 * 60;
const LAYOUT_ID = /^[A-Za-z0-9]{8,16}$/;

export type ChartEmbedClaims = {
  v: 1;
  userId: number;
  layoutId: string | null;
  symbol: string;
  interval: string;
  exp: number;
};

function embedSecret(): string | null {
  const service = process.env.AICHART_SERVICE_TOKEN?.trim().replace(/\r$/, "");
  if (service && service.length >= 16) return service;
  const app = process.env.APP_SECRET?.trim().replace(/\r$/, "");
  if (app && app.length >= 16) return app;
  return null;
}

export function isChartEmbedConfigured(): boolean {
  return embedSecret() !== null;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function equalSig(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** HMAC capability token: the MCP-connected user, not a guest session. */
export function mintChartEmbedToken(input: {
  userId: number;
  layoutId?: string | null;
  symbol?: string | null;
  interval?: string | null;
  ttlSec?: number;
  nowSec?: number;
}): string {
  const secret = embedSecret();
  if (!secret) {
    throw new Error("Chart embed signing is not configured.");
  }
  if (!Number.isInteger(input.userId) || input.userId <= 0) {
    throw new Error("Chart embed requires a user id.");
  }
  const layoutId = input.layoutId && LAYOUT_ID.test(input.layoutId) ? input.layoutId : null;
  const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
  const ttl = input.ttlSec && input.ttlSec > 0 ? input.ttlSec : DEFAULT_TTL_SEC;
  const claims: ChartEmbedClaims = {
    v: 1,
    userId: input.userId,
    layoutId,
    symbol: coerceToGold(input.symbol),
    interval: normalizeInterval(input.interval || "15m"),
    exp: nowSec + ttl,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyChartEmbedToken(
  token: string | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): ChartEmbedClaims | null {
  if (!token) return null;
  const secret = embedSecret();
  if (!secret) return null;
  const parts = token.trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, sig] = parts;
  if (!equalSig(signPayload(payload, secret), sig)) return null;
  try {
    const raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ChartEmbedClaims>;
    if (raw.v !== 1) return null;
    if (typeof raw.userId !== "number" || !Number.isInteger(raw.userId) || raw.userId <= 0) {
      return null;
    }
    if (typeof raw.exp !== "number" || raw.exp <= nowSec) return null;
    const layoutId =
      typeof raw.layoutId === "string" && LAYOUT_ID.test(raw.layoutId) ? raw.layoutId : null;
    return {
      v: 1,
      userId: raw.userId,
      layoutId,
      symbol: coerceToGold(raw.symbol),
      interval: normalizeInterval(typeof raw.interval === "string" ? raw.interval : "15m"),
      exp: raw.exp,
    };
  } catch {
    return null;
  }
}

export function publicChartEmbedUrl(opts: {
  token: string;
  theme?: string;
  locale?: string;
}): string {
  const q = new URLSearchParams();
  q.set("token", opts.token);
  if (opts.theme === "light" || opts.theme === "dark") q.set("theme", opts.theme);
  if (opts.locale === "ar" || opts.locale === "en") q.set("locale", opts.locale);
  return `${getPublicAppUrl()}/embed/chart?${q.toString()}`;
}

export function mintChartEmbedUrl(input: {
  userId: number;
  layoutId?: string | null;
  symbol?: string | null;
  interval?: string | null;
  theme?: string;
  locale?: string;
  ttlSec?: number;
}): string {
  return publicChartEmbedUrl({
    token: mintChartEmbedToken(input),
    theme: input.theme,
    locale: input.locale,
  });
}

export function tryMintChartEmbedUrl(
  input: Parameters<typeof mintChartEmbedUrl>[0],
): string | null {
  if (!isChartEmbedConfigured()) return null;
  try {
    return mintChartEmbedUrl(input);
  } catch {
    return null;
  }
}
