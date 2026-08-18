import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  mintChartEmbedToken,
  mintChartEmbedUrl,
  verifyChartEmbedToken,
} from "../embedChartToken";
import { DATA_SYMBOL } from "../gold";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("chart embed token", () => {
  it("mints a token bound to the MCP user and layout", () => {
    process.env.AICHART_SERVICE_TOKEN = "embed-test-secret-16";
    const token = mintChartEmbedToken({
      userId: 42,
      layoutId: "Abcd1234",
      symbol: "xauusdm",
      interval: "15m",
      nowSec: 1_700_000_000,
      ttlSec: 60,
    });
    const claims = verifyChartEmbedToken(token, 1_700_000_010);
    assert.ok(claims);
    assert.equal(claims.userId, 42);
    assert.equal(claims.layoutId, "Abcd1234");
    assert.equal(claims.symbol, DATA_SYMBOL);
    assert.equal(claims.interval, "15m");
    assert.equal(claims.exp, 1_700_000_060);
  });

  it("rejects a tampered payload and an expired token", () => {
    process.env.AICHART_SERVICE_TOKEN = "embed-test-secret-16";
    const token = mintChartEmbedToken({
      userId: 7,
      layoutId: "Layout99aa",
      nowSec: 1_700_000_000,
      ttlSec: 30,
    });
    const [payload, sig] = token.split(".");
    const tampered = payload.replace(/.$/, payload.endsWith("A") ? "B" : "A");
    assert.equal(verifyChartEmbedToken(`${tampered}.${sig}`, 1_700_000_000), null);
    assert.equal(verifyChartEmbedToken(token, 1_700_000_031), null);
  });

  it("rejects a token signed with a different secret", () => {
    process.env.AICHART_SERVICE_TOKEN = "embed-test-secret-16";
    const token = mintChartEmbedToken({ userId: 3, layoutId: "UserChart1" });
    process.env.AICHART_SERVICE_TOKEN = "other-test-secret-16";
    assert.equal(verifyChartEmbedToken(token), null);
  });

  it("builds a public embed URL that carries the token and no guest fallback", () => {
    process.env.AICHART_SERVICE_TOKEN = "embed-test-secret-16";
    process.env.APP_URL = "https://aichart.lork.cloud";
    const url = mintChartEmbedUrl({
      userId: 9,
      layoutId: "Primary01",
      interval: "15m",
      theme: "dark",
      locale: "ar",
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://aichart.lork.cloud");
    assert.equal(parsed.pathname, "/embed/chart");
    assert.ok(parsed.searchParams.get("token"));
    assert.equal(parsed.searchParams.get("theme"), "dark");
    assert.equal(parsed.searchParams.get("locale"), "ar");
    assert.equal(parsed.searchParams.get("symbol"), null);
    const claims = verifyChartEmbedToken(parsed.searchParams.get("token"));
    assert.equal(claims?.userId, 9);
    assert.equal(claims?.layoutId, "Primary01");
  });
});
