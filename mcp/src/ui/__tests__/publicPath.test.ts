import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeWidgetPublicPath } from "../publicPath.js";
import { widgetHtmlByPublicPath } from "../index.js";

describe("normalizeWidgetPublicPath", () => {
  it("fixes comma-joined version paths", () => {
    assert.equal(normalizeWidgetPublicPath("account-overview,v1"), "account-overview/v1");
  });

  it("strips ui:// prefix", () => {
    assert.equal(
      normalizeWidgetPublicPath("ui://aichart/portfolio.html"),
      "portfolio.html",
    );
  });
});

describe("slim widget shells", () => {
  it("resolves comma path to registered widget HTML", () => {
    const hit = widgetHtmlByPublicPath("account-overview,v1");
    assert.ok(hit);
    assert.ok(hit.html.includes("aic-runtime.js"));
    assert.ok(!hit.html.includes("window.openai"));
    assert.ok(hit.html.length < 8000, `shell too large: ${hit.html.length} bytes`);
  });
});
