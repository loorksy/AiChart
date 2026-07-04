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

describe("self-contained widget shells", () => {
  it("resolves comma path to registered widget HTML", () => {
    const hit = widgetHtmlByPublicPath("account-overview,v2");
    assert.ok(hit);
    // Host sandboxes block external assets — runtime must ship inline.
    assert.ok(hit.html.includes("window.AIC"));
    assert.ok(!/<(script|link)[^>]+(src|href)=/i.test(hit.html));
    assert.ok(hit.html.length < 80000, `shell too large: ${hit.html.length} bytes`);
  });
});
