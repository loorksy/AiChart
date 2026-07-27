/**
 * Tiny deterministic PNG fixtures for visual-evidence tests.
 *
 * Generated in-repo (not scraped from licensed chart libraries). Each constant
 * is a valid 1×1 PNG so image association / failure-isolation can be exercised
 * without network access or TradingView assets.
 */

/** 1×1 PNG — opaque dark pixel. Used as the "primary" timeframe image. */
export const FIXTURE_PNG_PRIMARY_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** 1×1 PNG — different bytes so timeframe binding can be asserted. */
export const FIXTURE_PNG_CONTEXT_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/** Empty / failed capture — must not abort the rest of the analysis. */
export const FIXTURE_PNG_MISSING = "";
