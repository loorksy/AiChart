/**
 * Phase 8 — self-vision: TradingView client snapshots only, two-shot pair,
 * honest flags, and the always-shown transparency line.
 *
 * The capture mechanics (browserless → named failure with NO image, the
 * missing_shots refusal, coerceVisualConfirmation's drawings requirement)
 * are pinned in chart/__tests__/liveCapture.test.ts. What is pinned here is
 * the surface the OPERATOR sees and the structural guarantee that no other
 * image source can creep back into the vision path.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { deriveCards } from "@/lib/agent/cards/deriveCards";
import { renderCardsForTelegram } from "@/lib/agent/cards/telegramCards";
import { visualTransparencyLine } from "@/lib/recommendations/visualTransparency";
import type { AgentFinalResult } from "@/lib/agent/types";

const SRC = path.join(import.meta.dirname, "..", "..");

function buyResult(over: Partial<AgentFinalResult> = {}): AgentFinalResult {
  return {
    decision: "buy",
    summary: "شراء من منطقة الطلب.",
    confidence: 62,
    keyReasons: [],
    riskWarnings: [],
    activityEvents: [],
    recommendation: {
      action: "buy",
      entry: 4000,
      stop_loss: 3980,
      targets: [4040],
    } as AgentFinalResult["recommendation"],
    ...over,
  } as AgentFinalResult;
}

describe("the transparency line exists in BOTH states and is never empty", () => {
  it("names the verified state with its frames", () => {
    const line = visualTransparencyLine({
      state: "confirmed",
      timeframesReviewed: ["15m", "1h"],
    });
    assert.ok(line.length > 10);
    assert.match(line, /TradingView/);
    assert.match(line, /15m/);
  });

  it("states numeric-only plainly — absence is a sentence, not silence", () => {
    const line = visualTransparencyLine({ state: "not_checked" });
    assert.ok(line.length > 10);
    assert.notEqual(
      line,
      visualTransparencyLine({ state: "confirmed", timeframesReviewed: [] }),
    );
    assert.match(line, /رقمية/);
  });

  it("the contradicted state is its own distinct sentence", () => {
    const line = visualTransparencyLine({ state: "contradicted" });
    assert.ok(line.length > 10);
    assert.notEqual(line, visualTransparencyLine({ state: "not_checked" }));
  });
});

describe("every recommendation carries the visual_review card", () => {
  it("a browserless run's result (no visualReview) still yields the card — not_checked", () => {
    const cards = deriveCards(buyResult());
    const visual = cards.find((card) => card.kind === "visual_review");
    assert.ok(visual, "the card must exist even with no visual data");
    if (visual?.kind === "visual_review") {
      assert.equal(visual.state, "not_checked");
      assert.deepEqual(visual.timeframes, []);
    }
  });

  it("a browser-session run yields the card in the confirmed state", () => {
    const cards = deriveCards(
      buyResult({
        visualReview: { state: "confirmed", timeframes: ["15m", "1h", "4h"] },
      }),
    );
    const visual = cards.find((card) => card.kind === "visual_review");
    assert.ok(visual);
    if (visual?.kind === "visual_review") {
      assert.equal(visual.state, "confirmed");
      assert.deepEqual(visual.timeframes, ["15m", "1h", "4h"]);
    }
  });

  it("a WAIT-style refusal (no recommendation) carries no plan and no line", () => {
    const cards = deriveCards(
      buyResult({ decision: "informational", recommendation: undefined }),
    );
    assert.equal(cards.some((card) => card.kind === "visual_review"), false);
  });

  it("the Telegram rendering includes the line in both states", () => {
    const confirmed = renderCardsForTelegram(
      deriveCards(buyResult({ visualReview: { state: "confirmed", timeframes: ["1h"] } })),
      "ar",
    );
    assert.match(confirmed, /TradingView/);
    const blind = renderCardsForTelegram(deriveCards(buyResult()), "ar");
    assert.match(blind, /رقمية/);
  });
});

describe("TradingView-only: no other image source can reach the vision path", () => {
  const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

  it("the capture pipeline neither imports nor renders a substitute image", () => {
    for (const rel of [
      "chart/liveCapture.ts",
      "chart/multiTimeframeCapture.ts",
      "chart/platformCapture.ts",
      "agent/visualEvidence.ts",
    ]) {
      const source = read(rel);
      assert.doesNotMatch(
        source,
        /from "@\/lib\/chartSnapshot"/,
        `${rel} must not import the QuickChart renderer`,
      );
      assert.doesNotMatch(source, /quickchart\.io/, rel);
      // The rejected techniques are never USED — imports and launches, not
      // the prose that states the prohibition.
      assert.doesNotMatch(
        source,
        /from ["'](playwright|puppeteer)|require\(["'](playwright|puppeteer)|chromium\.launch|\.launch\(\{\s*headless/i,
        rel,
      );
    }
  });

  it("browser automation exists NOWHERE in the app — chart-host is the only module allowed to drive a browser", () => {
    // The narrow exception (owner decision): a Playwright process inside the
    // chart-host container, hosting the internal /chart-host page ONLY, so
    // chart snapshots work unattended. Everything else stays rejected:
    // no playwright/puppeteer import anywhere in src/ or mcp/src, ever.
    const roots = [SRC, path.join(SRC, "..", "..", "mcp", "src")];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__tests__") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|mts)$/.test(entry.name)) continue;
        const source = readFileSync(full, "utf8");
        if (
          /from ["'](playwright|puppeteer)|require\(["'](playwright|puppeteer)|import\(["'](playwright|puppeteer)|chromium\.launch|\.launch\(\{\s*headless/i.test(
            source,
          )
        ) {
          offenders.push(full);
        }
      }
    };
    for (const root of roots) walk(root);
    assert.deepEqual(offenders, [], "browser automation leaked outside chart-host");
  });

  it("chart-host itself never captures — it HOSTS the page, takeClientScreenshot does the capturing", () => {
    const hostDir = path.join(SRC, "..", "..", "chart-host", "src");
    const forbidden =
      /\.screenshot\s*\(|page\.pdf\s*\(|newCDPSession|createCDPSession/i;
    for (const entry of readdirSync(hostDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const source = readFileSync(path.join(hostDir, entry.name), "utf8");
      assert.doesNotMatch(
        source,
        forbidden,
        `chart-host/src/${entry.name} must not capture, render, or open CDP itself`,
      );
    }
    // And the single-page restriction is structural, not advisory: the
    // session layer refuses navigation outside /chart-host by name.
    const session = readFileSync(path.join(hostDir, "session.ts"), "utf8");
    assert.match(session, /host_navigation_refused/);
    assert.match(session, /allowedPagePrefix/);
  });

  it("the vision path never serves a cached snapshot as this run's eyes", () => {
    const source = read("chart/multiTimeframeCapture.ts");
    assert.doesNotMatch(source, /getCachedChartSnapshot|setCachedChartSnapshot/);
  });

  it("the two-shot windows are the contract's numbers", () => {
    const source = read("chart/captureWindow.ts");
    assert.match(source, /CHART_CONTEXT_CANDLES = 400/);
    assert.match(source, /CHART_ZOOM_CANDLES = 90/);
  });
});
