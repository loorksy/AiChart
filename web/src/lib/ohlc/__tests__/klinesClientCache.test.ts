import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getKlinesClientCache,
  klinesClientKey,
  setKlinesClientCache,
} from "@/lib/ohlc/klinesClientCache";

describe("klinesClientCache", () => {
  it("stores and retrieves candles by key", () => {
    const key = klinesClientKey("BTCUSDT", "1h", "crypto");
    const bars = [{ time: 100, open: 1, high: 2, low: 0.5, close: 1.5 }];
    setKlinesClientCache(key, bars);
    assert.deepEqual(getKlinesClientCache(key), bars);
  });

  it("normalizes symbol case in keys", () => {
    const a = klinesClientKey("btcusdt", "1h", "crypto");
    const b = klinesClientKey("BTCUSDT", "1h", "crypto");
    assert.equal(a, b);
  });
});
