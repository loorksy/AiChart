import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * `QuantOhlcBar.time` is epoch milliseconds on this side; the service's `Bar`
 * model declares `time: str` (ISO 8601). Pydantic does not coerce an int into
 * a str, so sending a raw bar is a hard HTTP 422, not a soft mismatch.
 *
 * This was a live bug: `backtestQuantStrategy` converted, and
 * `generateQuantRecommendation` did not — so the recommendation endpoint had
 * never once succeeded from web. It hid for as long as it did because both
 * crons `continue` when the feed returns no bars, so the request body was
 * only ever constructed once real candles existed. Verified against the
 * deployed service: epoch-ms body -> 422, ISO body -> 200.
 */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const client = readFileSync(join(REPO_ROOT, "src/lib/quantAgent/client.ts"), "utf-8");
/** quant-agent/ is a sibling of web/, not inside it. */
const models = readFileSync(
  join(REPO_ROOT, "..", "quant-agent", "app", "storage", "models.py"),
  "utf-8",
).replace(/\r/g, "");

/**
 * The Bar class body, up to the next top-level class. Matching non-greedily to
 * a blank line stops inside the class docstring, before any field is seen.
 */
function barModelBody(): string {
  const match = models.match(/class Bar\(BaseModel\):[\s\S]*?(?=\nclass |$)/);
  assert.ok(match, "quant-agent must still define a Bar model");
  return match[0];
}

test("the service still declares Bar.time as a string", () => {
  // If this becomes an int or a datetime, the client's ISO conversion has to
  // change with it — asserting against the real model is the whole point.
  assert.match(
    barModelBody(),
    /time:\s*str\s*=\s*Field\(/,
    "Bar.time is no longer a str — the client's ISO conversion needs revisiting",
  );
});

test("every bar-carrying call serialises through the one shared converter", () => {
  assert.match(
    client,
    /function toServiceBars\(/,
    "a single conversion point must exist so callers cannot diverge",
  );
  assert.match(
    client,
    /time:\s*new Date\(bar\.time\)\.toISOString\(\)/,
    "epoch ms must be converted to ISO 8601",
  );

  // Neither caller may pass bars through raw.
  assert.doesNotMatch(
    client,
    /bars:\s*input\.bars\b/,
    "generateQuantRecommendation must not send raw epoch-ms bars (this was the 422)",
  );
  assert.doesNotMatch(
    client,
    /bars:\s*params\.bars\b(?!\.)/,
    "backtestQuantStrategy must not send raw epoch-ms bars",
  );

  const converted = client.match(/bars:\s*toServiceBars\(/g) ?? [];
  assert.equal(
    converted.length,
    2,
    `expected both bar-carrying calls to use toServiceBars, found ${converted.length}`,
  );
});

test("the converter emits the exact field set the Bar model accepts", () => {
  // Bar sets extra="forbid", so an unknown key is a 422 just like a bad type.
  assert.match(
    barModelBody(),
    /extra="forbid"/,
    "Bar forbids unknown keys — the emitted field set must match exactly",
  );

  const fn = client.match(/function toServiceBars\([\s\S]*?\n}/);
  assert.ok(fn, "toServiceBars must be findable");
  for (const field of ["time", "open", "high", "low", "close", "volume"]) {
    assert.match(fn[0], new RegExp(`\\b${field}:`), `toServiceBars must emit ${field}`);
  }
  assert.match(fn[0], /volume:\s*bar\.volume \?\? null/, "absent volume must be null, not undefined");
});
