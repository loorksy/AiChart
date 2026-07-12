import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

/**
 * Regression guard: the chat panel must NOT reintroduce a static quick-action
 * toolbar. All follow-up prompts are dynamic, model-generated suggestions
 * rendered per turn — never hardcoded buttons or a static fallback list.
 */
const here = dirname(fileURLToPath(import.meta.url));
const panelSrc = readFileSync(
  join(here, "..", "SmartChartAgentPanel.tsx"),
  "utf8",
);

describe("no static quick-action toolbar", () => {
  it("does not render the old analyze/news quick-action buttons", () => {
    assert.ok(
      !panelSrc.includes("agent.analyze_chart"),
      "static 'Analyze chart' quick-action button must not be present",
    );
    assert.ok(
      !panelSrc.includes("agent.news_risk"),
      "static 'News risk' quick-action button must not be present",
    );
    assert.ok(
      !panelSrc.includes("NEWS_QUICK_PROMPT"),
      "the news quick-prompt must not be wired to a static button",
    );
  });

  it("still renders dynamic per-turn suggestions (m.options)", () => {
    assert.ok(
      panelSrc.includes("m.options"),
      "dynamic model-generated suggestions must remain",
    );
  });
});
