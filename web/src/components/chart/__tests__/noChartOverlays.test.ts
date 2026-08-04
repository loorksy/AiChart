/**
 * The chart surface must not layer hand-built chrome over the TradingView
 * widget. Library features own symbol legend, resolution, and (when licensed)
 * trading; bid/ask are createShape price lines.
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

  it("keeps the library header for live charts and strips it only for capture", () => {
    assert.match(tvChart, /header_widget/);
    assert.match(tvChart, /isCapture/);
    assert.match(tvChart, /SpreadPriceLines/);
    assert.match(tvChart, /createApprovalBroker/);
  });
});
