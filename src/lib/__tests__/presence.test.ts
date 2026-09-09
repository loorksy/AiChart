import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIVE_ZSET_KEY,
  PRESENCE_TIMEZONE,
  PRESENCE_TTL_MS,
  aggregatePaths,
  calendarDateInZone,
  countLive,
  isBotUserAgent,
  isValidVisitorId,
  newVisitorId,
  normalizePublicPath,
  parseVisitorId,
  pruneLive,
  readTraffic,
  recordHeartbeat,
  uniqueAdd,
  uniqSetKey,
  visitorCookieOptions,
  visitorPathKey,
  type LiveEntry,
  type PresenceRedis,
} from "../presence";

describe("bot filter", () => {
  it("lets ordinary browsers through", () => {
    assert.equal(
      isBotUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0",
      ),
      false,
    );
    assert.equal(isBotUserAgent(null), false);
    assert.equal(isBotUserAgent(""), false);
  });

  it("drops obvious crawlers and CLI clients", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "curl/8.7.1",
      "Wget/1.21.4",
      "python-requests/2.31.0",
      "GPTBot/1.0",
      "facebookexternalhit/1.1",
    ]) {
      assert.equal(isBotUserAgent(ua), true, ua);
    }
  });
});

describe("public path allow-list", () => {
  it("accepts the five PublicChrome routes and strips query/hash", () => {
    assert.equal(normalizePublicPath("/"), "/");
    assert.equal(normalizePublicPath("/pricing?plan=1"), "/pricing");
    assert.equal(normalizePublicPath("/privacy#cookies"), "/privacy");
    assert.equal(normalizePublicPath("/login/"), "/login");
    assert.equal(normalizePublicPath("/signup"), "/signup");
  });

  it("rejects APIs, admin, chat, and junk", () => {
    for (const path of [
      "/api/public/presence",
      "/admin-app/",
      "/chat",
      "/console",
      "/healthz",
      "/metrics",
      "https://evil.example/",
      "",
      12,
      null,
    ]) {
      assert.equal(normalizePublicPath(path), null, String(path));
    }
  });
});

describe("visitor id", () => {
  it("accepts a UUID and rejects garbage", () => {
    const id = newVisitorId();
    assert.equal(isValidVisitorId(id), true);
    assert.equal(parseVisitorId(id.toUpperCase()), id.toLowerCase());
    assert.equal(parseVisitorId("not-a-uuid"), null);
    assert.equal(parseVisitorId("'; FLUSHALL"), null);
  });
});

describe("Asia/Riyadh calendar day", () => {
  it("rolls at Riyadh midnight, not UTC midnight", () => {
    assert.equal(PRESENCE_TIMEZONE, "Asia/Riyadh");
    // 20:30 UTC on 9 Sep = 23:30 in Riyadh — still the 9th.
    assert.equal(
      calendarDateInZone(Date.UTC(2026, 8, 9, 20, 30, 0)),
      "2026-09-09",
    );
    // 21:00 UTC on 9 Sep = 00:00 on the 10th in Riyadh.
    assert.equal(
      calendarDateInZone(Date.UTC(2026, 8, 9, 21, 0, 0)),
      "2026-09-10",
    );
  });
});

describe("live TTL prune", () => {
  const t0 = 1_000_000;
  const entries: LiveEntry[] = [
    { vid: "fresh", score: t0 - 10_000, path: "/" },
    { vid: "edge", score: t0 - PRESENCE_TTL_MS + 1, path: "/pricing" },
    { vid: "stale", score: t0 - PRESENCE_TTL_MS, path: "/privacy" },
    { vid: "gone", score: t0 - PRESENCE_TTL_MS - 1, path: "/login" },
  ];

  it("keeps only scores newer than now − 90s", () => {
    const live = pruneLive(entries, t0);
    assert.deepEqual(
      live.map((e) => e.vid),
      ["fresh", "edge"],
    );
    assert.equal(countLive(entries, t0), 2);
    assert.equal(countLive(entries, t0 + 2), 1);
  });
});

describe("unique increment", () => {
  it("counts a vid once per day", () => {
    const first = uniqueAdd([], "a");
    assert.equal(first.added, true);
    assert.equal(first.size, 1);
    const again = uniqueAdd(first.members, "a");
    assert.equal(again.added, false);
    assert.equal(again.size, 1);
    const other = uniqueAdd(again.members, "b");
    assert.equal(other.added, true);
    assert.equal(other.size, 2);
  });
});

describe("recent path rollup", () => {
  it("groups surviving live entries", () => {
    const rolled = aggregatePaths([
      { vid: "1", score: 1, path: "/" },
      { vid: "2", score: 1, path: "/" },
      { vid: "3", score: 1, path: "/pricing" },
      { vid: "4", score: 1, path: "/chat" },
    ]);
    assert.deepEqual(rolled, [
      { path: "/", count: 2 },
      { path: "/pricing", count: 1 },
    ]);
  });
});

class FakePresenceRedis implements PresenceRedis {
  zset = new Map<string, number>();
  strings = new Map<string, { value: string; exp?: number }>();
  sets = new Map<string, Set<string>>();
  now = 0;

  async zadd(_key: string, score: number, member: string): Promise<number> {
    this.zset.set(member, score);
    return 1;
  }
  async zremrangebyscore(
    _key: string,
    min: number | string,
    max: number | string,
  ): Promise<number> {
    const lo = min === "-inf" ? -Infinity : Number(min);
    const hi = max === "+inf" ? Infinity : Number(max);
    let n = 0;
    for (const [member, score] of this.zset) {
      if (score >= lo && score <= hi) {
        this.zset.delete(member);
        n += 1;
      }
    }
    return n;
  }
  async zcount(
    _key: string,
    min: number | string,
    max: number | string,
  ): Promise<number> {
    const lo = String(min).startsWith("(")
      ? Number(String(min).slice(1)) + 1e-9
      : min === "-inf"
        ? -Infinity
        : Number(min);
    const hi = max === "+inf" ? Infinity : Number(max);
    let n = 0;
    for (const score of this.zset.values()) {
      if (score >= lo && score <= hi) n += 1;
    }
    return n;
  }
  async zrangebyscore(
    _key: string,
    min: number | string,
    max: number | string,
  ): Promise<string[]> {
    const lo = String(min).startsWith("(")
      ? Number(String(min).slice(1)) + 1e-9
      : Number(min);
    const hi = max === "+inf" ? Infinity : Number(max);
    return [...this.zset.entries()]
      .filter(([, score]) => score >= lo && score <= hi)
      .map(([member]) => member);
  }
  async set(key: string, value: string): Promise<string> {
    this.strings.set(key, { value });
    return "OK";
  }
  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map((k) => this.strings.get(k)?.value ?? null);
  }
  async sadd(key: string, member: string): Promise<number> {
    const set = this.sets.get(key) ?? new Set();
    const added = !set.has(member);
    set.add(member);
    this.sets.set(key, set);
    return added ? 1 : 0;
  }
  async scard(key: string): Promise<number> {
    return this.sets.get(key)?.size ?? 0;
  }
  async expire(): Promise<number> {
    return 1;
  }
}

describe("Redis-backed heartbeat (mocked client)", () => {
  it("writes live + daily unique and prunes the TTL window", async () => {
    const redis = new FakePresenceRedis();
    const t0 = Date.UTC(2026, 8, 9, 10, 0, 0);
    const vid = "11111111-1111-4111-8111-111111111111";

    assert.equal(await recordHeartbeat(vid, "/", t0, redis), true);
    assert.equal(await recordHeartbeat(vid, "/pricing", t0 + 1_000, redis), true);
    assert.equal(redis.zset.get(vid), t0 + 1_000);
    assert.equal(redis.strings.get(visitorPathKey(vid))?.value, "/pricing");
    assert.equal(redis.sets.get(uniqSetKey("2026-09-09"))?.size, 1);

    const other = "22222222-2222-4222-8222-222222222222";
    assert.equal(await recordHeartbeat(other, "/login", t0 + 2_000, redis), true);

    const mid = await readTraffic(t0 + 3_000, redis);
    assert.equal(mid.live, 2);
    assert.equal(mid.today, 2);
    assert.equal(mid.timezone, "Asia/Riyadh");
    assert.deepEqual(mid.recent_paths, [
      { path: "/login", count: 1 },
      { path: "/pricing", count: 1 },
    ]);

    redis.zset.set(vid, t0 - PRESENCE_TTL_MS);
    const later = await readTraffic(t0 + 3_000, redis);
    assert.equal(later.live, 1);
    assert.equal(later.today, 2, "daily unique is not pruned with live TTL");
    assert.ok(!redis.zset.has(vid));
    assert.equal(LIVE_ZSET_KEY, "lonora:presence:live");
  });

  it("fails soft when Redis is missing", async () => {
    assert.equal(await recordHeartbeat("x", "/", Date.now(), null), false);
    const stats = await readTraffic(Date.now(), null);
    assert.deepEqual(stats, {
      live: 0,
      today: 0,
      timezone: "Asia/Riyadh",
      recent_paths: [],
    });
  });
});

describe("cookie flags", () => {
  it("is HttpOnly, Lax, path=/, year-long", () => {
    const opts = visitorCookieOptions();
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.sameSite, "lax");
    assert.equal(opts.path, "/");
    assert.equal(opts.maxAge, 60 * 60 * 24 * 365);
  });
});
