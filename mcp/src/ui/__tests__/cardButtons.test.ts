import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WIDGETS } from "../widgets.js";
import { RUNTIME_JS, widgetHtml } from "../runtime.js";
import { TOOL_CATALOG } from "../../tools/schemas/index.js";

/**
 * A card never acts. It shows.
 *
 * This file used to draw a careful line between APPROVAL surfaces (buttons
 * allowed — their click only calls `respond_approval`, which re-runs every
 * server-side check before anything reaches a broker) and EXECUTION surfaces
 * (buttons never allowed — one click would place or close a real position).
 * That line was the right one while the server exposed both kinds of tool.
 *
 * It no longer exposes either. The platform issues recommendations, holds no
 * broker connection, and places no orders, so there is nothing to approve and
 * nothing to execute. The distinction collapses into the simpler rule the
 * product now actually has, and that is what these tests hold: **no card may
 * carry a control at all.**
 *
 * The reason this is a test rather than a convention is unchanged: the runtime
 * (`AIC.callTool`) can call any named tool through the host bridge with full
 * auth, so nothing at the transport layer stops a card from trying. And a
 * button wired to a tool that no longer exists is worse than a useless
 * control — it is a control that fails in the operator's hands after they have
 * been told it does something.
 */

const BUTTON_PATTERNS: RegExp[] = [
  /<button\b/i,
  /role\s*=\s*["']button["']/i,
  /type\s*=\s*["']button["']/i,
  /type\s*=\s*["']submit["']/i,
  /<input\b[^>]*type\s*=\s*["'](?:button|submit)["']/i,
];

function hasButtons(html: string): boolean {
  return BUTTON_PATTERNS.some((re) => re.test(html));
}

describe("MCP cards: a card shows, it never acts", () => {
  it("no widget carries a button", () => {
    const offenders = Object.entries(WIDGETS)
      .filter(([, html]) => hasButtons(html))
      .map(([name]) => name);
    assert.deepEqual(
      offenders,
      [],
      "a card is a display surface; there is no order to place and nothing to approve",
    );
  });

  it("a widget may refresh what it shows, never change anything", () => {
    // A card calling `get_ohlc` to redraw itself is still only showing. What
    // it may never do is call a tool that WRITES — which on this surface means
    // create_recommendation and the drawing tools. The check runs against the
    // real catalogue's annotations rather than a hardcoded allow-list, so a
    // future write tool is caught here without anyone remembering to add it.
    const writeTools = new Set(
      TOOL_CATALOG.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name),
    );
    const registered = new Set(TOOL_CATALOG.map((t) => t.name));
    for (const [name, html] of Object.entries(WIDGETS)) {
      const calls = [...html.matchAll(/AIC\.callTool\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
      for (const called of calls) {
        assert.ok(
          registered.has(called),
          `widget ${name} calls "${called}", which this server does not expose — ` +
            "a control that fails in the operator's hands",
        );
        assert.ok(
          !writeTools.has(called),
          `widget ${name} calls write tool "${called}" — a card shows, it never acts`,
        );
      }
    }
  });

  it("every widget a tool points at is actually registered", () => {
    for (const tool of TOOL_CATALOG) {
      const widgetName = tool.ui?.widget;
      if (!widgetName) continue;
      assert.ok(
        WIDGETS[widgetName],
        `${tool.name} → widget "${widgetName}" is not registered`,
      );
    }
  });

  it("no dead button click handlers or follow-up calls remain", () => {
    for (const [name, html] of Object.entries(WIDGETS)) {
      assert.equal(
        /getElementById\(\s*["'](refresh|manage|deep|action|pause|open|chart)["']\s*\)/.test(html),
        false,
        `widget ${name} still references a removed button element`,
      );
      assert.equal(
        /sendFollowUpMessage/.test(html),
        false,
        `widget ${name} still calls sendFollowUpMessage (button-only bridge call)`,
      );
    }
  });

  it("the shared runtime + a plain assembled shell contain no buttons", () => {
    // The runtime is generic plumbing shared by every card — it must not
    // hardcode a control, only expose the bridge a card could have used.
    assert.equal(hasButtons(RUNTIME_JS), false, "RUNTIME_JS must not contain a button");
    const page = widgetHtml("test", '<div class="card">x</div>', "");
    assert.equal(hasButtons(page), false, "an empty assembled shell must not contain a button");
  });

  it("cards default to Arabic/RTL at the document shell", () => {
    const page = widgetHtml("t", "<div>x</div>", "");
    assert.match(page, /<html lang="ar" dir="rtl">/);
  });
});
