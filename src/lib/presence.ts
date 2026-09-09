/**
 * First-party anonymous visitor presence for public pages only.
 *
 * Live  = distinct `lonora_vid` heartbeats in the last ~90s
 * Today = distinct `lonora_vid` first seen on this calendar day
 *
 * "Today" uses Asia/Riyadh (UTC+3). Every writer and reader must use this
 * zone — do not mix UTC calendar dates with Riyadh dates.
 *
 * This is NOT registered-user traffic. Do not fold it into usersTotal /
 * usersActive. Heartbeats are accepted only from PublicChrome pages
 * (`/`, `/pricing`, `/privacy`, `/login`, `/signup`). `/api/*`,
 * `/admin-app/*`, health/metrics, and authenticated `/chat` are out of
 * scope for v1.
 *
 * Redis keys:
 *   ZADD lonora:presence:live <tsMs> <vid>
 *   SET  lonora:presence:path:{vid} <path> EX 90
 *   SADD lonora:uniq:YYYY-MM-DD <vid>
 *
 * Redis is best-effort. A down broker must never break a public page:
 * writers return false and readers return zeros.
 */
import { randomUUID } from "node:crypto";

export const VISITOR_COOKIE = "lonora_vid";
export const VISITOR_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;
export const PRESENCE_TTL_MS = 90_000;
export const PRESENCE_TTL_SEC = 90;
export const PRESENCE_TIMEZONE = "Asia/Riyadh";
export const UNIQ_SET_TTL_SEC = 60 * 60 * 24 * 3;

export const LIVE_ZSET_KEY = "lonora:presence:live";

export const PUBLIC_PRESENCE_PATHS = [
  "/",
  "/pricing",
  "/privacy",
  "/login",
  "/signup",
] as const;

export type PublicPresencePath = (typeof PUBLIC_PRESENCE_PATHS)[number];

const PUBLIC_PATH_SET = new Set<string>(PUBLIC_PRESENCE_PATHS);

/** Obvious crawlers / CLI clients — not a fingerprint, just UA substrings. */
const BOT_UA =
  /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex(?:bot)?|facebookexternalhit|twitterbot|linkedinbot|embedly|pinterest|redditbot|applebot|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|gptbot|chatgpt-user|claudebot|anthropic|ccbot|curl(?:\/|\b)|wget(?:\/|\b)|httpie|python-requests|go-http-client|libwww-perl|scrapy|headlesschrome|phantomjs|selenium|lighthouse|pingdom|uptimerobot|statuscake|preview|crawler|spider|bot\b/i;

const VISITOR_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LiveEntry {
  vid: string;
  score: number;
  path?: string;
}

export interface PathCount {
  path: string;
  count: number;
}

export interface TrafficStats {
  live: number;
  today: number;
  timezone: string;
  recent_paths: PathCount[];
}

export interface PresenceRedis {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<unknown>;
  zcount(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number>;
  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<string[]>;
  set(key: string, value: string, ...extra: unknown[]): Promise<unknown>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  sadd(key: string, member: string): Promise<number>;
  scard(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export function visitorPathKey(vid: string): string {
  return `lonora:presence:path:${vid}`;
}

export function uniqSetKey(day: string): string {
  return `lonora:uniq:${day}`;
}

export function newVisitorId(): string {
  return randomUUID();
}

export function isValidVisitorId(raw: string | null | undefined): boolean {
  return typeof raw === "string" && VISITOR_ID_RE.test(raw.trim());
}

export function parseVisitorId(raw: string | null | undefined): string | null {
  if (!isValidVisitorId(raw)) return null;
  return raw!.trim().toLowerCase();
}

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return BOT_UA.test(ua);
}

/**
 * Accept only the public marketing/auth paths. Query/hash/trailing slash
 * are stripped; everything else (including `/chat` and `/api/*`) is dropped.
 */
export function normalizePublicPath(raw: unknown): PublicPresencePath | null {
  if (typeof raw !== "string") return null;
  let path = raw.trim();
  if (!path) return null;
  const hash = path.indexOf("#");
  if (hash >= 0) path = path.slice(0, hash);
  const query = path.indexOf("?");
  if (query >= 0) path = path.slice(0, query);
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path.startsWith("/api") || path.startsWith("/admin-app")) return null;
  if (!PUBLIC_PATH_SET.has(path)) return null;
  return path as PublicPresencePath;
}

/** Calendar date `YYYY-MM-DD` in {@link PRESENCE_TIMEZONE}. */
export function calendarDateInZone(
  now: Date | number = Date.now(),
  timeZone: string = PRESENCE_TIMEZONE,
): string {
  const date = typeof now === "number" ? new Date(now) : now;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function liveCutoff(nowMs: number, ttlMs: number = PRESENCE_TTL_MS): number {
  return nowMs - ttlMs;
}

/** Drop heartbeats whose score is not strictly newer than now − TTL. */
export function pruneLive(
  entries: LiveEntry[],
  nowMs: number,
  ttlMs: number = PRESENCE_TTL_MS,
): LiveEntry[] {
  const cutoff = liveCutoff(nowMs, ttlMs);
  return entries.filter((e) => e.score > cutoff);
}

export function countLive(
  entries: LiveEntry[],
  nowMs: number,
  ttlMs: number = PRESENCE_TTL_MS,
): number {
  return pruneLive(entries, nowMs, ttlMs).length;
}

/** First insert of `vid` grows the set; repeats do not. */
export function uniqueAdd(
  existing: Iterable<string>,
  vid: string,
): { members: string[]; added: boolean; size: number } {
  const members = new Set(existing);
  const added = !members.has(vid);
  members.add(vid);
  return { members: [...members], added, size: members.size };
}

export function aggregatePaths(entries: LiveEntry[]): PathCount[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const path = e.path && PUBLIC_PATH_SET.has(e.path) ? e.path : null;
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
}

export function visitorCookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_SEC,
  };
}

let redisClient: import("ioredis").default | null = null;
let redisUnavailable = false;

async function getPresenceRedis(): Promise<PresenceRedis | null> {
  if (redisUnavailable) return null;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (redisClient) return redisClient;
  try {
    const { default: IORedis } = await import("ioredis");
    const client = new IORedis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    client.on("error", () => {
      /* presence is best-effort */
    });
    await client.connect();
    redisClient = client;
    return client;
  } catch {
    redisUnavailable = true;
    redisClient = null;
    return null;
  }
}

export async function recordHeartbeat(
  vid: string,
  path: PublicPresencePath,
  nowMs: number = Date.now(),
  redis?: PresenceRedis | null,
): Promise<boolean> {
  const client = redis === undefined ? await getPresenceRedis() : redis;
  if (!client) return false;
  try {
    const cutoff = liveCutoff(nowMs);
    const day = calendarDateInZone(nowMs);
    const uniqKey = uniqSetKey(day);
    await client.zadd(LIVE_ZSET_KEY, nowMs, vid);
    await client.zremrangebyscore(LIVE_ZSET_KEY, "-inf", cutoff);
    await client.set(visitorPathKey(vid), path, "EX", PRESENCE_TTL_SEC);
    await client.sadd(uniqKey, vid);
    await client.expire(uniqKey, UNIQ_SET_TTL_SEC);
    return true;
  } catch {
    return false;
  }
}

export async function readTraffic(
  nowMs: number = Date.now(),
  redis?: PresenceRedis | null,
): Promise<TrafficStats> {
  const empty: TrafficStats = {
    live: 0,
    today: 0,
    timezone: PRESENCE_TIMEZONE,
    recent_paths: [],
  };
  const client = redis === undefined ? await getPresenceRedis() : redis;
  if (!client) return empty;
  try {
    const cutoff = liveCutoff(nowMs);
    await client.zremrangebyscore(LIVE_ZSET_KEY, "-inf", cutoff);
    const [liveRaw, todayRaw, vids] = await Promise.all([
      client.zcount(LIVE_ZSET_KEY, cutoff + 1, "+inf"),
      client.scard(uniqSetKey(calendarDateInZone(nowMs))),
      client.zrangebyscore(LIVE_ZSET_KEY, cutoff + 1, "+inf"),
    ]);
    const live = Number(liveRaw) || 0;
    const today = Number(todayRaw) || 0;
    let recent_paths: PathCount[] = [];
    if (vids.length > 0 && vids.length <= 500) {
      const paths = await client.mget(...vids.map(visitorPathKey));
      recent_paths = aggregatePaths(
        vids.map((vid, i) => ({
          vid,
          score: nowMs,
          path: paths[i] ?? undefined,
        })),
      );
    }
    return {
      live,
      today,
      timezone: PRESENCE_TIMEZONE,
      recent_paths,
    };
  } catch {
    return empty;
  }
}
