import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_TIMEOUTS,
  MCP_ANALYZE_TIMEOUT_MS,
  TOTAL_RUN_BUDGET_MS,
  withDeadline,
} from "@/lib/agent/timeout";

/** A cancellable sleep that reports whether it was aborted. */
function cancellable(ms: number, signal: AbortSignal, state: { aborted: boolean }) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => resolve("completed"), ms);
    signal.addEventListener(
      "abort",
      () => {
        state.aborted = true;
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

describe("withDeadline (item 2: real cancellation)", () => {
  it("returns the value when the work finishes in time", async () => {
    const state = { aborted: false };
    const out = await withDeadline((s) => cancellable(5, s, state), 200, "fallback");
    assert.equal(out, "completed");
  });

  it("ALWAYS aborts the underlying work, even on the success path", async () => {
    const state = { aborted: false };
    await withDeadline((s) => cancellable(5, s, state), 200, "fallback");
    // The wrapper settled; the controller must be torn down regardless.
    assert.equal(state.aborted, true, "signal must be aborted after settling");
  });

  it("returns the fallback AND aborts the work when the deadline hits", async () => {
    const state = { aborted: false };
    const out = await withDeadline((s) => cancellable(5_000, s, state), 20, "fallback");
    assert.equal(out, "fallback", "deadline yields the fallback (unchanged contract)");
    assert.equal(state.aborted, true, "the underlying work must actually be cancelled");
  });

  it("propagates a real error (not swallowed as a deadline)", async () => {
    await assert.rejects(
      () => withDeadline(async () => { throw new Error("provider exploded"); }, 200, "fallback"),
      /provider exploded/,
    );
  });

  it("never starts the work when the parent signal is already aborted", async () => {
    const parent = AbortSignal.abort();
    let invoked = false;
    const out = await withDeadline(
      async () => {
        invoked = true;
        return "completed";
      },
      5_000,
      "fallback",
      parent,
    );
    assert.equal(out, "fallback");
    assert.equal(invoked, false, "a cancelled run must not spend a provider call");
  });

  it("aborts the work when the parent aborts mid-flight", async () => {
    const parent = new AbortController();
    const state = { aborted: false };
    setTimeout(() => parent.abort(), 20);
    const out = await withDeadline(
      (s) => cancellable(5_000, s, state),
      5_000,
      "fallback",
      parent.signal,
    );
    assert.equal(out, "fallback", "a cancelled run degrades to the fallback");
    assert.equal(state.aborted, true);
  });
});

describe("run budget stays under the MCP ceiling", () => {
  it("total budget is below the MCP tool wait", () => {
    assert.ok(
      TOTAL_RUN_BUDGET_MS < MCP_ANALYZE_TIMEOUT_MS,
      `total budget ${TOTAL_RUN_BUDGET_MS} must stay under MCP ${MCP_ANALYZE_TIMEOUT_MS}`,
    );
  });

  it("the longest single-stage chain fits inside the total budget", () => {
    // Worst realistic serial chain: market data → (parallel fleet) → risk →
    // final decision → drawing. The parallel fleet costs its slowest member.
    const fleet = Math.max(
      AGENT_TIMEOUTS.structure,
      AGENT_TIMEOUTS.liquidity,
      AGENT_TIMEOUTS.supplyDemand,
      AGENT_TIMEOUTS.multiTimeframe,
      AGENT_TIMEOUTS.news,
    );
    const serial =
      AGENT_TIMEOUTS.marketData +
      fleet +
      AGENT_TIMEOUTS.risk +
      AGENT_TIMEOUTS.finalDecision +
      AGENT_TIMEOUTS.drawing;
    assert.ok(
      serial < TOTAL_RUN_BUDGET_MS,
      `serial chain ${serial}ms must fit in the ${TOTAL_RUN_BUDGET_MS}ms budget`,
    );
  });
});
