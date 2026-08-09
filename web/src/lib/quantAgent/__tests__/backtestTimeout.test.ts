import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * The client's global timeout is hard-capped at 30s, but the quant-agent
 * service's own `backtest_batch_timeout_seconds` defaults to 90 and is
 * settable to 300. Sharing one value means the caller aborts a run the callee
 * is still legitimately working on, and the chat wizard reports a timeout for
 * a backtest that would have produced real numbers. A caller deadline shorter
 * than the callee's is never a correct pairing, so the backtest path carries
 * its own.
 */
const CLIENT = "src/lib/quantAgent/client.ts";
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
/** quant-agent/ is a sibling of web/, not inside it. */
const CONFIG = join(REPO_ROOT, "..", "quant-agent", "app", "config.py");

const source = readFileSync(join(REPO_ROOT, CLIENT), "utf-8");

test("the backtest call does not inherit the 30s-capped global timeout", () => {
  assert.match(source, /function backtestTimeoutMs\(\)/, "a dedicated backtest deadline must exist");
  assert.match(
    source,
    /timeoutMs:\s*backtestTimeoutMs\(\)/,
    "backtestQuantStrategy must pass its own timeout, not fall through to the global default",
  );
});

test("the backtest deadline comfortably exceeds the service's batch timeout", () => {
  const configured = source.match(/QUANT_AGENT_BACKTEST_CLIENT_TIMEOUT_MS\s*\|\|\s*(\d[\d_]*)/);
  assert.ok(configured, "the backtest timeout default must be readable from the source");
  const defaultMs = Number(configured[1]!.replace(/_/g, ""));

  // Read the service's own default rather than restating it, so the two
  // cannot drift apart silently.
  const py = readFileSync(CONFIG, "utf-8");
  const batch = py.match(/backtest_batch_timeout_seconds:\s*int\s*=\s*Field\(default=(\d+)/);
  assert.ok(batch, "quant-agent config must declare backtest_batch_timeout_seconds");
  const serviceMs = Number(batch[1]!) * 1000;

  assert.ok(
    defaultMs > serviceMs,
    `client backtest timeout (${defaultMs}ms) must exceed the service's batch timeout (${serviceMs}ms)`,
  );
});

test("a timed-out backtest is not automatically retried", () => {
  assert.match(
    source,
    /retryOnTimeout:\s*false/,
    "retrying a run that already consumed its full deadline doubles the worst case for the same work",
  );
  assert.match(
    source,
    /options\.retryOnTimeout === false/,
    "serviceRequest must actually honour the flag",
  );
});

test("the global timeout is still capped for ordinary calls", () => {
  assert.match(
    source,
    /Math\.min\(30_000,\s*Math\.max\(100,\s*configured\)\)/,
    "ordinary calls keep the 30s cap — the exemption is for the backtest path only",
  );
});
