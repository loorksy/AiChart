import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reproduced live on production (pre-OANDA-migration): a browser with
 * `aichart_last_symbol` cached from before the case-preservation fix
 * ("XAUUSDM", uppercased) loaded that value verbatim on mount, and the
 * broker-suffixed spelling was not recognised, so the badge showed no price.
 *
 * The component has no React Testing Library harness in this repo, so this
 * pins the fix at the source level: the localStorage read must be wrapped in
 * normalizeSymbolCase, and dataSource must initialise straight on the
 * platform's OANDA feed — there is no per-account placeholder to reconcile.
 */

const SRC = readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "SmartChartWorkspace.tsx",
  ),
  "utf8",
);

describe("SmartChartWorkspace initial state matches server truth", () => {
  it("normalises a cached symbol on the way out of localStorage", () => {
    assert.match(
      SRC,
      /return normalizeSymbolCase\(localStorage\.getItem\(LS_SYMBOL\) \?\? DEFAULT_SYMBOL\)/,
      "a symbol cached before the case fix must be corrected on read, not trusted verbatim",
    );
  });

  it("initialises straight on the OANDA platform pipe — no account placeholder to reconcile", () => {
    assert.match(
      SRC,
      /useState<MarketDataSource>\("oanda"\)/,
      "the one pipe is the platform's OANDA feed; there is no paint-time account placeholder",
    );
  });

  it("live-capture poller keeps answering when the tab is in the background", () => {
    const captureBlock = SRC.slice(
      SRC.indexOf("Live-capture RPC"),
      SRC.indexOf("const t = window.setInterval(() => void tick(), 400)"),
    );
    assert.doesNotMatch(
      captureBlock,
      /visibilityState/,
      "MCP captures arrive while the operator is in Claude — a hidden /chat tab must still poll",
    );
  });
});
