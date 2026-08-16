/**
 * The chart surface must not layer hand-built chrome over the TradingView
 * widget. Library features own symbol legend and resolution; bid/ask are
 * createShape price lines. Orders are sent only by the agent — the chart must
 * never expose buy/sell or other chart-owned trading controls (not a license
 * gap; product decision).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const workspace = readFileSync(
  join(__dirname, "../../SmartChartWorkspace.tsx"),
  "utf8",
);
const tvChart = readFileSync(join(__dirname, "../TvChart.tsx"), "utf8");

describe("no hand-built chart overlays", () => {
  it("does not mount ChartChrome / ChartLivePriceBadge / ChartBuySellTicket", () => {
    assert.doesNotMatch(workspace, /<ChartChrome\b/);
    assert.doesNotMatch(workspace, /<ChartLivePriceBadge\b/);
    assert.doesNotMatch(workspace, /<ChartBuySellTicket\b/);
  });

  it("never enables chart-owned trading UI (buy/sell buttons or broker adapter)", () => {
    assert.doesNotMatch(tvChart, /buy_sell_buttons/);
    assert.doesNotMatch(tvChart, /broker_factory/);
    assert.doesNotMatch(tvChart, /createApprovalBroker/);
    assert.doesNotMatch(workspace, /tradingEnabled/);
  });

  it("hides library header and bottom chrome on live charts, not only capture", () => {
    assert.match(tvChart, /header_widget/);
    assert.match(tvChart, /timeframes_toolbar/);
    assert.match(tvChart, /control_bar/);
    assert.match(tvChart, /showSeriesTitle": false/);
    assert.match(tvChart, /custom_css_url/);
    assert.match(tvChart, /SpreadPriceLines/);
    assert.doesNotMatch(tvChart, /enabled_features:[\s\S]{0,200}header_widget/);
  });
});
