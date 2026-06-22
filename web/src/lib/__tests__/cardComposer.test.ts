import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeCardSchema, type ToolDatum } from "@/lib/cardComposer";

const components = (s: ReturnType<typeof composeCardSchema>) =>
  (s?.layout ?? []).map((e) => e.component);

describe("composeCardSchema — deterministic, shape-driven, model-independent", () => {
  it("returns null when no tool data", () => {
    assert.equal(composeCardSchema([]), null);
  });

  it("returns null for unrenderable shapes (plain chat)", () => {
    const td: ToolDatum[] = [{ name: "x", data: { hello: "world" } }];
    assert.equal(composeCardSchema(td), null);
  });

  it("single snapshot -> analysis (by shape, any tool name)", () => {
    const td: ToolDatum[] = [
      {
        name: "anything",
        data: {
          symbol: "BTCUSDT",
          price: 64000,
          high24h: 65000,
          low24h: 63000,
          summary: "trending up",
          extra: { trend: "bullish", rsi14: 61, macd: "positive" },
        },
      },
    ];
    const s = composeCardSchema(td);
    assert.deepEqual(components(s), ["analysis"]);
    assert.equal(s!.layout[0].props.symbol, "BTCUSDT");
    assert.equal(s!.layout[0].props.trend, "bullish");
  });

  it("multi-timeframe snapshot -> analysis + mtf_grid", () => {
    const td: ToolDatum[] = [
      {
        name: "get_multi_timeframe_snapshot",
        data: {
          symbol: "EURUSDm",
          snapshots: [
            { interval: "1h", snapshot: { symbol: "EURUSDm", price: 1.16, high24h: 1.17, low24h: 1.15, summary: "s", extra: { trend: "bearish", rsi14: 42 } } },
            { interval: "4h", snapshot: { symbol: "EURUSDm", price: 1.16, extra: { trend: "bullish" } } },
          ],
        },
      },
    ];
    const s = composeCardSchema(td);
    assert.deepEqual(components(s), ["analysis", "mtf_grid"]);
    const rows = s!.layout[1].props.rows as { tf: string; signal: string }[];
    assert.deepEqual(rows, [
      { tf: "1h", signal: "sell" },
      { tf: "4h", signal: "buy" },
    ]);
  });

  it("bridge envelope {ok,data} with symbols[] -> pair_browser", () => {
    const td: ToolDatum[] = [
      {
        name: "get_account_symbols",
        data: { ok: true, data: { symbols: [{ symbol: "ADAUSDm", market: "crypto", bid: 0.33, ask: 0.34, spreadPct: 0.8 }] } },
      },
    ];
    assert.deepEqual(components(composeCardSchema(td)), ["pair_browser"]);
  });

  it("open trades -> positions_table (mapped fields)", () => {
    const td: ToolDatum[] = [
      {
        name: "get_open_trades",
        data: { aichartTrades: [{ id: 7, symbol: "XAUUSDm", side: "buy", notional: 50, pnl: 3.2 }] },
      },
    ];
    const s = composeCardSchema(td);
    assert.deepEqual(components(s), ["positions_table"]);
    const pos = (s!.layout[0].props.positions as any[])[0];
    assert.equal(pos.tradeId, 7);
    assert.equal(pos.size, 50);
  });

  it("account overview -> account_overview", () => {
    const td: ToolDatum[] = [
      { name: "get_account_overview", data: { account: { balance: 99.8, equity: 100.2, marginLevel: 3000 } } },
    ];
    assert.deepEqual(components(composeCardSchema(td)), ["account_overview"]);
  });

  it("readiness with blockers -> alert_banner (warning)", () => {
    const td: ToolDatum[] = [
      { name: "get_trade_readiness", data: { ready: false, blockers: [{ message_ar: "السوق مغلق" }] } },
    ];
    const s = composeCardSchema(td);
    assert.deepEqual(components(s), ["alert_banner"]);
    assert.equal(s!.layout[0].props.type, "warning");
  });

  it("combines multiple shapes, analysis before pairs, de-duped", () => {
    const td: ToolDatum[] = [
      { name: "get_account_symbols", data: { symbols: [{ symbol: "BTCUSDm", bid: 1, ask: 2 }] } },
      { name: "get_market_snapshot", data: { symbol: "BTCUSDm", price: 1, high24h: 2, low24h: 0, extra: { trend: "bullish" } } },
    ];
    assert.deepEqual(components(composeCardSchema(td)), ["analysis", "pair_browser"]);
  });

  it("multi-TF analysis wins over single snapshot (no duplicate analysis)", () => {
    const td: ToolDatum[] = [
      { name: "get_market_snapshot", data: { symbol: "BTCUSDm", price: 1, high24h: 2, low24h: 0, extra: { trend: "bearish" } } },
      { name: "get_multi_timeframe_snapshot", data: { symbol: "BTCUSDm", snapshots: [{ interval: "1h", snapshot: { symbol: "BTCUSDm", price: 1, extra: { trend: "bullish" } } }] } },
    ];
    const s = composeCardSchema(td);
    assert.deepEqual(components(s), ["analysis", "mtf_grid"]);
    // analysis came from the multi-TF detector (priority), trend bullish
    assert.equal(s!.layout[0].props.trend, "bullish");
  });
});
