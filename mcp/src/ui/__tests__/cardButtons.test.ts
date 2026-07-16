import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WIDGETS } from "../widgets.js";
import { RUNTIME_JS, widgetHtml } from "../runtime.js";

/** Patterns that would indicate a AiChart-owned interactive control in a card. */
const BUTTON_PATTERNS: RegExp[] = [
  /<button\b/i,
  /role\s*=\s*["']button["']/i,
  /type\s*=\s*["']button["']/i,
  /type\s*=\s*["']submit["']/i,
  /<input\b[^>]*type\s*=\s*["'](?:button|submit)["']/i,
];

function assertNoButtons(label: string, html: string) {
  for (const re of BUTTON_PATTERNS) {
    assert.equal(re.test(html), false, `${label} must not contain ${re}`);
  }
}

describe("MCP cards are read-only (no card-owned buttons)", () => {
  it("no registered widget template contains a button", () => {
    const names = Object.keys(WIDGETS);
    assert.ok(names.length >= 10, "expected the full widget catalog");
    for (const name of names) {
      assertNoButtons(`widget ${name}`, WIDGETS[name]!);
    }
  });

  it("the shared runtime + full page shell contain no buttons", () => {
    assertNoButtons("RUNTIME_JS", RUNTIME_JS);
    // A representative fully-assembled page (shell + runtime + a card body).
    const page = widgetHtml("test", '<div class="card">x</div>', "");
    assertNoButtons("assembled page", page);
  });

  it("no dead button click handlers or follow-up calls remain in cards", () => {
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

  it("cards default to Arabic/RTL at the document shell", () => {
    const page = widgetHtml("t", "<div>x</div>", "");
    assert.match(page, /<html lang="ar" dir="rtl">/);
  });
});
