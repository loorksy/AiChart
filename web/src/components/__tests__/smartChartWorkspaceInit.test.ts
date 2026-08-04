import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Reproduced live on production: a browser with `aichart_last_symbol` cached
 * from before the case-preservation fix ("XAUUSDM", uppercased) loaded that
 * value verbatim on mount. MetaApi does not recognise the uppercased spelling
 * — cloudQuote's catch silently falls back to the platform feed — and the
 * platform feed does not recognise the broker-suffixed spelling either, so
 * the badge showed no price and no spread for a linked, working account.
 *
 * The component has no React Testing Library harness in this repo, so this
 * pins the fix at the source level: the localStorage read must be wrapped in
 * normalizeSymbolCase, and dataSource must be reconciled against the server's
 * resolved default rather than trusting the "oanda" paint-time placeholder.
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

  it("resolves the real data source on mount instead of staying on the oanda placeholder", () => {
    const stateInit = SRC.slice(
      SRC.indexOf('useState<MarketDataSource>("oanda")'),
      SRC.indexOf("const [tradesOpen"),
    );
    assert.match(
      stateInit,
      /fetch\("\/api\/market\/data-source"/,
      "dataSource must be reconciled against the server's resolved pipe on mount",
    );
    assert.match(
      stateInit,
      /setDataSource\(data\.active\)/,
      "the resolved active source must actually be applied, not just fetched",
    );
  });
});
