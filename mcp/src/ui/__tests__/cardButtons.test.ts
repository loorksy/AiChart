import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WIDGETS } from "../widgets.js";
import { RUNTIME_JS, widgetHtml } from "../runtime.js";
import { TOOL_CATALOG } from "../../tools/schemas/index.js";

/**
 * A card is an APPROVAL surface, never an EXECUTION surface.
 *
 * The runtime (`AIC.callTool`) has always been able to call any named tool
 * through the real host bridge with full auth — nothing at the transport
 * layer stops a card from calling open_trade. This test is the guard that
 * decides which cards are ALLOWED to, and it draws the line at what actually
 * moves money versus what only proposes it:
 *
 *  - request_approval / respond_approval / get_pending_approvals: their
 *    button click still only calls respond_approval, which itself re-runs
 *    revalidation and every technical-execution-safety check before
 *    anything reaches a broker — the button is a UI shortcut for a decision
 *    the operator is making anyway, not a bypass of it.
 *  - open_trade / close_trade / close_partial / modify_sl_tp /
 *    cancel_mt5_order (and any future execution tool): a button here would
 *    let a single click place, close, or modify a real position with no
 *    server-side confirmation step in between. These get NO buttons, ever.
 *
 * This used to be a blanket "no widget anywhere may contain a button" rule
 * (see git history) — a button-driven pattern was tried, hit a real problem
 * in production, and was rolled back wholesale. Re-reading the actual
 * failure mode: the risk was buttons on cards that DO things, not buttons on
 * cards whose only action is the approval decision the operator was already
 * about to make in chat. So the rule is narrowed to that distinction instead
 * of re-litigated from scratch — this test enforces the narrowed line by
 * reading the real TOOL_CATALOG → widget wiring, not a hardcoded guess at
 * which widgets exist, so a future tool that adds `ui.widget` to an
 * execution tool fails here even if nobody remembers this comment.
 */

const APPROVAL_SURFACE_TOOLS = new Set([
  "request_approval",
  "respond_approval",
  "get_pending_approvals",
]);

/** Tools whose annotations mark them as placing/closing/modifying a real
 *  order — the never-buttons list, named explicitly so a missing one is a
 *  loud test failure, not a silent gap. */
const EXECUTION_TOOLS = [
  "open_trade",
  "close_trade",
  "close_partial",
  "modify_sl_tp",
  "cancel_mt5_order",
];

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

describe("MCP cards: buttons are an approval surface, never an execution surface", () => {
  it("only request_approval/respond_approval/get_pending_approvals may point at a button-carrying widget", () => {
    for (const tool of TOOL_CATALOG) {
      const widgetName = tool.ui?.widget;
      if (!widgetName) continue;
      const html = WIDGETS[widgetName];
      if (!html) continue; // covered separately by widgets.test.ts's catalog-linkage check
      if (!hasButtons(html)) continue;
      assert.ok(
        APPROVAL_SURFACE_TOOLS.has(tool.name),
        `${tool.name} → widget "${widgetName}" contains a button, but only ` +
          `${[...APPROVAL_SURFACE_TOOLS].join("/")} may render card-owned buttons`,
      );
    }
  });

  it("no execution tool ever points at a button-carrying widget", () => {
    for (const name of EXECUTION_TOOLS) {
      const tool = TOOL_CATALOG.find((t) => t.name === name);
      assert.ok(tool, `${name} must exist in the catalog (list is stale)`);
      const widgetName = tool!.ui?.widget;
      if (!widgetName) continue; // no widget at all is fine — that's the safe default
      const html = WIDGETS[widgetName];
      assert.ok(html, `${name} → widget "${widgetName}" is not registered`);
      assert.equal(
        hasButtons(html),
        false,
        `${name} → widget "${widgetName}" must not contain a button — ` +
          `a card is an approval surface, never an execution surface`,
      );
    }
  });

  it("the approval-flow widgets actually contain approve/reject buttons", () => {
    // Guards against silently losing the pattern (e.g. a refactor that drops
    // the buttons and this test going green for the wrong reason).
    for (const toolName of APPROVAL_SURFACE_TOOLS) {
      const tool = TOOL_CATALOG.find((t) => t.name === toolName);
      const widgetName = tool?.ui?.widget;
      if (!widgetName) continue; // get_pending_approvals is the only read; others always carry ui.widget today
      const html = WIDGETS[widgetName];
      assert.ok(html, `${toolName} → widget "${widgetName}" is not registered`);
      assert.ok(
        hasButtons(html),
        `${toolName}'s widget "${widgetName}" should contain approve/reject buttons`,
      );
    }
  });

  it("no button-carrying widget ever calls an execution tool", () => {
    // Buttons in these two widgets call respond_approval (the decision) and,
    // for the queue, a read-only get_pending_approvals refetch afterward to
    // resync the list — never a tool that itself places/closes/modifies an
    // order. The real invariant isn't "only one tool name", it's "never an
    // execution tool", so check against EXECUTION_TOOLS directly.
    for (const [name, html] of Object.entries(WIDGETS)) {
      if (!hasButtons(html)) continue;
      const calls = [...html.matchAll(/AIC\.callTool\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `widget ${name} has a button but never calls a tool`);
      for (const called of calls) {
        assert.ok(
          !EXECUTION_TOOLS.includes(called),
          `widget ${name} calls execution tool "${called}" — buttons must never trigger execution`,
        );
      }
    }
  });

  it("no dead button click handlers or follow-up calls remain in non-approval cards", () => {
    for (const [name, html] of Object.entries(WIDGETS)) {
      if (hasButtons(html)) continue; // approval-card / approval-queue: real buttons, checked above
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
    // The runtime itself is generic plumbing shared by every card, including
    // the button-carrying ones — it must not hardcode a button, only expose
    // AIC.callTool for a card's own markup to use.
    assert.equal(hasButtons(RUNTIME_JS), false, "RUNTIME_JS must not contain a button");
    const page = widgetHtml("test", '<div class="card">x</div>', "");
    assert.equal(hasButtons(page), false, "an empty assembled shell must not contain a button");
  });

  it("cards default to Arabic/RTL at the document shell", () => {
    const page = widgetHtml("t", "<div>x</div>", "");
    assert.match(page, /<html lang="ar" dir="rtl">/);
  });
});
