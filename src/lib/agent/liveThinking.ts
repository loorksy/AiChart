/**
 * Live model thinking — the operator-facing trace of the model's own
 * reasoning channel, not a timeframe-keyed template.
 *
 * Provider thinking/reasoning deltas (Anthropic `thinking` blocks, OpenAI
 * `reasoning_content`) land here. The sink:
 *  - sanitizes with the same leakage scrubbers as every other thinking line;
 *  - emits a new line every 3–10 seconds, or sooner when a real step
 *    completes and a sentence is ready;
 *  - deduplicates consecutive identical lines;
 *  - caps length and count.
 *
 * Canned `thinkingNarration.ts` lines are FALLBACK only: the orchestrator
 * emits them if this sink produced nothing for the whole run.
 */
import { sanitizeThinkingLine } from "./thinkingNarration";

export const THINKING_MIN_INTERVAL_MS = 3_000;
export const THINKING_MAX_INTERVAL_MS = 10_000;
export const THINKING_MAX_LINE_CHARS = 280;
export const THINKING_MAX_LINES = 24;

const SENTENCE_END = /(?<=[.!?…\u061F。\n])\s+/;

export interface LiveThinkingSink {
  /** Append a provider thinking/reasoning delta. */
  ingestDelta: (text: string) => void;
  /** A complete model-authored note (browse question, stage thought). */
  noteModelLine: (text: string) => void;
  /** A pipeline step finished — flush a ready sentence if we have one. */
  markStepComplete: () => void;
  /** Flush remaining buffer. */
  flush: () => void;
  emittedCount: () => number;
  /** True when at least one live (non-fallback) line was emitted. */
  hasLive: () => boolean;
}

export function createLiveThinkingSink(
  emit: (line: string) => void,
  opts?: {
    now?: () => number;
    minIntervalMs?: number;
    maxIntervalMs?: number;
  },
): LiveThinkingSink {
  const now = opts?.now ?? Date.now;
  const minMs = opts?.minIntervalMs ?? THINKING_MIN_INTERVAL_MS;
  const maxMs = opts?.maxIntervalMs ?? THINKING_MAX_INTERVAL_MS;
  let buffer = "";
  let lastEmitAt = 0;
  let lastLine = "";
  let count = 0;
  let live = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const publish = (raw: string, fromProvider: boolean) => {
    const clean = sanitizeThinkingLine(raw).slice(0, THINKING_MAX_LINE_CHARS);
    if (!clean || clean === lastLine) return false;
    lastLine = clean;
    lastEmitAt = now();
    count += 1;
    if (fromProvider) live = true;
    if (count <= THINKING_MAX_LINES) emit(clean);
    return true;
  };

  const takeSentence = (force: boolean): string | null => {
    const text = buffer.trim();
    if (!text) return null;
    const parts = text.split(SENTENCE_END).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    if (parts.length === 1 && !force && text.length < THINKING_MAX_LINE_CHARS) {
      return null;
    }
    const sentence = parts[0]!;
    const rest = parts.slice(1).join(" ");
    buffer = rest;
    return sentence;
  };

  const tryEmit = (force: boolean) => {
    const elapsed = now() - lastEmitAt;
    if (!force && elapsed < minMs && lastEmitAt !== 0) return;
    const sentence = takeSentence(force || elapsed >= maxMs);
    if (!sentence) return;
    publish(sentence, true);
  };

  const schedule = () => {
    clearTimer();
    const wait = lastEmitAt === 0 ? minMs : Math.max(minMs, maxMs - (now() - lastEmitAt));
    timer = setTimeout(() => {
      timer = null;
      tryEmit(true);
      if (buffer.trim()) schedule();
    }, Math.min(Math.max(wait, minMs), maxMs));
    if (typeof timer === "object" && timer && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }
  };

  return {
    ingestDelta(text: string) {
      if (!text) return;
      buffer += text;
      if (buffer.length > THINKING_MAX_LINE_CHARS * 4) {
        buffer = buffer.slice(-THINKING_MAX_LINE_CHARS * 3);
      }
      tryEmit(false);
      schedule();
    },
    noteModelLine(text: string) {
      const elapsed = now() - lastEmitAt;
      if (lastEmitAt !== 0 && elapsed < minMs) {
        // Hold until cadence allows — still a real model note, not a template.
        buffer = `${buffer} ${text}`.trim();
        schedule();
        return;
      }
      publish(text, true);
    },
    markStepComplete() {
      clearTimer();
      tryEmit(true);
    },
    flush() {
      clearTimer();
      tryEmit(true);
      const leftover = buffer.trim();
      buffer = "";
      if (leftover) publish(leftover, true);
    },
    emittedCount: () => count,
    hasLive: () => live,
  };
}

/** Emit canned narration only when the live sink produced nothing. */
export function emitNarrationFallback(
  emit: (line: string) => void,
  lines: Array<string | null | undefined>,
  liveCount: number,
): void {
  if (liveCount > 0) return;
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line) continue;
    const clean = sanitizeThinkingLine(line).slice(0, THINKING_MAX_LINE_CHARS);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    emit(clean);
  }
}
