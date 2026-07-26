import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResearchServiceError } from "@/lib/research/errors";
import {
  buildReconcilingPatch,
  buildTransportIncident,
  clearedTransportState,
  isTransportFailure,
  STATUS_UNKNOWN_THRESHOLD,
  transportStateAfterFailure,
} from "@/lib/research/transportState";

describe("transport failure is not job failure (item 4)", () => {
  it("classifies a polling timeout as transport, not a verdict", () => {
    const timeout = new ResearchServiceError(
      "RESEARCH_SERVICE_TIMEOUT",
      "Research Service request timed out after 10000ms",
      504,
    );
    assert.equal(isTransportFailure(timeout), true);
  });

  it("classifies an unreachable service as transport", () => {
    const down = new ResearchServiceError(
      "RESEARCH_SERVICE_UNAVAILABLE",
      "connection error",
      503,
    );
    assert.equal(isTransportFailure(down), true);
    const misconfigured = new ResearchServiceError(
      "RESEARCH_SERVICE_CONFIG_INVALID",
      "configuration incomplete",
      503,
    );
    assert.equal(isTransportFailure(misconfigured), true);
  });

  it("classifies bare network errors as transport", () => {
    assert.equal(isTransportFailure(new Error("fetch failed")), true);
    assert.equal(isTransportFailure(new Error("ECONNREFUSED 127.0.0.1:8090")), true);
    assert.equal(isTransportFailure(new Error("The operation was aborted")), true);
  });

  it("does NOT classify a real job verdict as transport", () => {
    // A 4xx/validation verdict is the service SPEAKING, not a lost connection.
    const rejected = new ResearchServiceError(
      "RESEARCH_SERVICE_ERROR",
      "job payload invalid",
      422,
    );
    assert.equal(isTransportFailure(rejected), false);
    assert.equal(
      isTransportFailure(new Error("Backtest evidence artifacts are incomplete")),
      false,
      "a missing artifact is a real job problem, not a transport one",
    );
  });
});

describe("transport state machine", () => {
  it("one blip is an interruption; a run of them is unknown", () => {
    assert.equal(transportStateAfterFailure(1), "poll_interrupted");
    assert.equal(transportStateAfterFailure(STATUS_UNKNOWN_THRESHOLD - 1), "poll_interrupted");
    assert.equal(transportStateAfterFailure(STATUS_UNKNOWN_THRESHOLD), "status_unknown");
    assert.equal(transportStateAfterFailure(STATUS_UNKNOWN_THRESHOLD + 5), "status_unknown");
  });

  it("a misconfigured/unreachable service is labelled distinctly", () => {
    const err = new ResearchServiceError(
      "RESEARCH_SERVICE_CONFIG_INVALID",
      "incomplete",
      503,
    );
    assert.equal(transportStateAfterFailure(1, err), "service_unreachable");
  });

  it("accumulates consecutive failures and never asserts the job died", () => {
    const first = buildTransportIncident(0, new Error("fetch failed"), 1_000);
    assert.equal(first.transport_state, "poll_interrupted");
    assert.equal(first.poll_failures, 1);
    assert.equal(first.last_failure_at, 1_000);
    assert.doesNotMatch(first.note, /failed/i, "the note must not imply job failure");

    const third = buildTransportIncident(2, new Error("fetch failed"), 2_000);
    assert.equal(third.transport_state, "status_unknown");
    assert.equal(third.poll_failures, 3);
    assert.match(third.note, /NOT assumed failed/);
  });

  it("reconciling and cleared states reset the failure count", () => {
    assert.equal(buildReconcilingPatch(5).transport_state, "reconciling");
    assert.equal(buildReconcilingPatch(5).poll_failures, 0);
    assert.equal(clearedTransportState(7).transport_state, "ok");
    assert.equal(clearedTransportState(7).poll_failures, 0);
  });
});
