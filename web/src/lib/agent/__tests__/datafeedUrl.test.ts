import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildKlinesUrl } from "@/lib/chart/tv/tvDatafeed";

describe("tvDatafeed/buildKlinesUrl", () => {
  it("normal getBars does NOT send fresh=1 (uses warehouse/cache)", () => {
    const url = buildKlinesUrl({
      symbol: "XAUUSD",
      interval: "15m",
      limit: 800,
      fresh: false,
    });
    assert.ok(!url.includes("fresh=1"), url);
  });

  it("manual refresh / forming candle may send fresh=1", () => {
    const url = buildKlinesUrl({
      symbol: "XAUUSD",
      interval: "15m",
      limit: 800,
      fresh: true,
    });
    assert.ok(url.includes("fresh=1"), url);
  });

  it("omitting fresh does not send fresh=1", () => {
    const url = buildKlinesUrl({ symbol: "EURUSD", interval: "1h" });
    assert.ok(!url.includes("fresh"), url);
  });

  it("strips the EA: ticker prefix from the symbol param", () => {
    const url = buildKlinesUrl({ symbol: "EA:XAUUSDm", interval: "5m", ea: true });
    assert.ok(url.includes("symbol=XAUUSDm"), url);
    assert.ok(url.includes("source=ea"), url);
  });
});
