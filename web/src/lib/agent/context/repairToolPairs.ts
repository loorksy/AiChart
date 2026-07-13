import { sanitizeContextText } from "./contextSafety";
import type { ContextLocale, ContextWarning, NormalizedContextMessage } from "./types";

const PLACEHOLDER = {
  en: "[Compressed tool history: a result existed but was compacted. Use the retained summary or call the tool again when current data is required.]",
  ar: "[سجل أداة مضغوط: كانت النتيجة موجودة ثم اختُصرت. استخدم الملخص المحفوظ أو استدعِ الأداة مجدداً عند الحاجة إلى بيانات حالية.]",
} as const;

export interface RepairToolPairsResult {
  messages: NormalizedContextMessage[];
  warnings: ContextWarning[];
  removedMessageIds: string[];
  placeholderCount: number;
}

export function repairToolPairs(
  messages: readonly NormalizedContextMessage[],
  locale: ContextLocale,
): RepairToolPairsResult {
  const calls = new Map<string, NormalizedContextMessage>();
  const results = new Map<string, NormalizedContextMessage>();
  const removedMessageIds: string[] = [];
  const warnings: ContextWarning[] = [];

  for (const message of messages) {
    if (message.kind === "tool_call" && message.toolCall?.id && !calls.has(message.toolCall.id)) {
      calls.set(message.toolCall.id, message);
    }
    if (message.kind === "tool_result" && message.toolCallId) {
      if (results.has(message.toolCallId)) removedMessageIds.push(results.get(message.toolCallId)!.id);
      results.set(message.toolCallId, message); // latest duplicate wins deterministically
    }
  }

  const emittedCalls = new Set<string>();
  const emittedResults = new Set<string>();
  const output: NormalizedContextMessage[] = [];
  let placeholderCount = 0;

  for (const message of messages) {
    if (message.kind === "tool_result") continue;
    if (message.kind !== "tool_call") {
      output.push(message);
      continue;
    }
    const callId = message.toolCall?.id;
    if (!callId || emittedCalls.has(callId)) {
      removedMessageIds.push(message.id);
      continue;
    }
    emittedCalls.add(callId);
    output.push(message);
    const result = results.get(callId);
    if (result) {
      const sanitized = sanitizeContextText(result.content, {
        maxChars: 2_000,
        messageId: result.id,
        untrusted: true,
      });
      output.push({ ...result, content: sanitized.text, safety: sanitized.classifications });
      warnings.push(...sanitized.warnings);
      emittedResults.add(callId);
      continue;
    }
    const placeholderId = `${message.id}:compacted-result`;
    output.push({
      id: placeholderId,
      role: "tool",
      kind: "tool_result",
      content: PLACEHOLDER[locale],
      sequence: message.sequence + 0.1,
      createdAt: message.createdAt,
      toolCallId: callId,
      safety: ["safe"],
      source: "summary",
    });
    warnings.push({ code: "tool_result_placeholder_added", messageId: placeholderId });
    placeholderCount += 1;
  }

  for (const [callId, result] of results) {
    if (calls.has(callId) && emittedResults.has(callId)) continue;
    removedMessageIds.push(result.id);
    warnings.push({ code: "orphan_tool_result_removed", messageId: result.id });
  }
  return { messages: output, warnings, removedMessageIds: [...new Set(removedMessageIds)], placeholderCount };
}
