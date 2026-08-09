/**
 * Decide what the voice layer is allowed to SPEAK from an agent result. Only the
 * public final answer (`summary`) is ever spoken — never activity events, debug
 * diagnostics, raw reasoning, JSON, tool payloads, or drawing-mutation objects.
 * Pure so the "never speak internals" guarantee is unit-testable.
 */
import type { AgentFinalResult } from "@/lib/agent/types";

export function speakableFromResult(
  result: Pick<AgentFinalResult, "summary">,
): string | null {
  const text = (result.summary ?? "").trim();
  return text.length > 0 ? text : null;
}
