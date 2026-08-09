/**
 * Transport failure ≠ job failure (RELIABILITY_PLAN.md item 4).
 *
 * The production incident this exists to prevent: a polling timeout marked
 * LIVE research jobs as "failed". The web side could not reach the service, so
 * it concluded the work had died — while the job was still running happily.
 * Losing the connection tells you nothing about the job.
 *
 * A job may only be declared failed on an explicit TERMINAL verdict from the
 * service. Everything else is a transport condition with its own vocabulary:
 *
 * - `poll_interrupted` — one poll failed to reach the service; the job's last
 *   known state still stands and polling will resume.
 * - `status_unknown`   — repeated polls failed; we genuinely do not know the
 *   job's state and must not guess (in either direction).
 * - `reconciling`      — the service is reachable again and the real state is
 *   being re-read to replace the assumed one.
 * - `service_unreachable` — the service itself is down (config/connection),
 *   distinct from a slow response.
 */
import { ResearchServiceError } from "./errors";
import { isTransientResearchError } from "./serviceErrors";

export type TransportState =
  | "ok"
  | "poll_interrupted"
  | "status_unknown"
  | "reconciling"
  | "service_unreachable";

/** Consecutive failed polls after which the state is no longer merely interrupted. */
export const STATUS_UNKNOWN_THRESHOLD = 3;

/**
 * True when the error is about REACHING the service, not about the job's
 * outcome. Such an error must never produce a terminal job state.
 */
export function isTransportFailure(error: unknown): boolean {
  if (isTransientResearchError(error)) return true;
  if (error instanceof ResearchServiceError) {
    return error.code === "RESEARCH_SERVICE_CONFIG_INVALID";
  }
  // A bare fetch/abort failure never reached a verdict either.
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("socket hang up") ||
    message.includes("aborted")
  );
}

/**
 * The transport state after a failed poll, given how many consecutive polls
 * have now failed. One blip is an interruption; a run of them means the state
 * is genuinely unknown.
 */
export function transportStateAfterFailure(
  consecutiveFailures: number,
  error?: unknown,
): TransportState {
  if (
    error instanceof ResearchServiceError &&
    error.code === "RESEARCH_SERVICE_CONFIG_INVALID"
  ) {
    return "service_unreachable";
  }
  return consecutiveFailures >= STATUS_UNKNOWN_THRESHOLD
    ? "status_unknown"
    : "poll_interrupted";
}

export interface TransportIncident {
  transport_state: TransportState;
  /** Consecutive failed polls so far. */
  poll_failures: number;
  /** Epoch ms of the last failed poll. */
  last_failure_at: number;
  /** Operator-facing note. Never a raw provider payload. */
  note: string;
}

/** Build the metadata patch recorded against a job whose POLL failed. */
export function buildTransportIncident(
  previousFailures: number,
  error: unknown,
  now: number = Date.now(),
): TransportIncident {
  const poll_failures = previousFailures + 1;
  const transport_state = transportStateAfterFailure(poll_failures, error);
  return {
    transport_state,
    poll_failures,
    last_failure_at: now,
    note:
      transport_state === "status_unknown"
        ? "Repeated polls could not reach the research service; the job's real state is unknown and is NOT assumed failed."
        : transport_state === "service_unreachable"
          ? "The research service is unreachable; the job's last known state stands."
          : "A single poll did not reach the research service; polling will resume.",
  };
}

/** Metadata patch for a job whose state is being re-read after an outage. */
export function buildReconcilingPatch(now: number = Date.now()): TransportIncident {
  return {
    transport_state: "reconciling",
    poll_failures: 0,
    last_failure_at: now,
    note: "The research service is reachable again; re-reading the job's real state.",
  };
}

/** Cleared transport state once a poll succeeds. */
export function clearedTransportState(now: number = Date.now()): TransportIncident {
  return {
    transport_state: "ok",
    poll_failures: 0,
    last_failure_at: now,
    note: "The research service responded; the job state is authoritative again.",
  };
}
