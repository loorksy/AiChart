/**
 * Cross-service trace correlation (RELIABILITY_PLAN.md item 9).
 *
 * One id must span: MCP tool call -> web request -> agent stages -> research
 * job. Previously each tier minted its own id, so an MCP-reported failure could
 * not be joined to the web run that produced it.
 *
 * The inbound id is UNTRUSTED input: it reaches operator logs and the
 * user-visible `envelope.trace_id`, so it is strictly validated rather than
 * echoed. Anything unexpected is rejected and the receiver mints its own — a
 * correlation id is a convenience, never a reason to accept arbitrary text.
 */

/** Header carrying the correlation id across tiers. */
export const TRACE_ID_HEADER = "x-aichart-request-id";

const TRACE_ID_PATTERN = /^[A-Za-z0-9_:.-]{8,80}$/;

/**
 * Validate an externally-supplied correlation id. Returns null unless it is a
 * plain, bounded token — no whitespace, no control characters, no injection
 * surface for log or UI rendering.
 */
export function sanitizeTraceId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return TRACE_ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** Read + validate the correlation id from an inbound request. */
export function inboundTraceId(req: {
  headers: { get(name: string): string | null };
}): string | null {
  return sanitizeTraceId(req.headers.get(TRACE_ID_HEADER));
}
