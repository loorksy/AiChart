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

  it("still renders dynamic per-turn suggestions", () => {
    // This used to grep the panel for `m.options`, and it FAILED when the card
    // layer took the suggestion buttons over — which is the guard working, not
    // the guard being wrong. The property it protects is "suggestions are
    // model-generated per turn, never a static toolbar", and that still holds:
    // `m.options` was itself only ever `result.options ?? []` (see
    // `useSmartChartAgent`), and restored history sets it from `result.options`
    // too (`recordToMessage`), so the deriver reading `result.options` sees the
    // same data on a live turn and a reloaded one.
    //
    // So the assertion follows the path instead of the old variable name.
    assert.ok(
      panelSrc.includes("<AgentCards"),
      "the panel must mount the card layer that renders the suggestions",
    );
    assert.ok(
      panelSrc.includes("onOption={(prompt) => void sendMessage(prompt)}"),
      "a suggestion must still send its prompt as a chat message",
    );

    const derive = readFileSync(
      join(here, "..", "..", "..", "lib", "agent", "cards", "deriveCards.ts"),
      "utf8",
    );
    assert.ok(
      derive.includes("result.options?.length") &&
        derive.includes('kind: "follow_up_options"'),
      "the suggestions must come from the run's own options, per turn",
    );
  });
});
