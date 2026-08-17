import type { AgentFinalResult, AgentOption } from "@/lib/agent/types";

export interface RecoveredAssistantTurn {
  content: string;
  result?: AgentFinalResult;
  options?: AgentOption[];
  createdAt?: number;
}

export interface RecoverableChatMessage {
  role: "user" | "assistant" | string;
  content: string;
  result?: unknown;
  createdAt?: number;
}

/**
 * After a dropped agent stream, the server may have finished and persisted
 * the assistant turn. Find that turn: the assistant that follows the matching
 * user message, or the latest assistant if the user line is missing.
 */
export function pickRecoveredAssistant(
  messages: RecoverableChatMessage[],
  userContent: string,
): RecoveredAssistantTurn | null {
  const wanted = userContent.trim();
  if (!wanted || !messages.length) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i];
    if (row.role !== "user" || row.content.trim() !== wanted) continue;
    const next = messages[i + 1];
    if (next?.role === "assistant" && next.content.trim()) {
      return toRecovered(next);
    }
    return null;
  }

  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.content.trim()) {
    return toRecovered(last);
  }
  return null;
}

function toRecovered(row: RecoverableChatMessage): RecoveredAssistantTurn {
  const result = row.result as AgentFinalResult | undefined;
  return {
    content: row.content,
    result,
    options: result?.options,
    createdAt: row.createdAt,
  };
}
