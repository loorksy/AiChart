/**
 * Activity-event helpers. Every public message the agent surfaces passes
 * through `sanitizeActivityMessage` so raw chain-of-thought phrasing never
 * reaches the user, in either Arabic or English.
 */
import type { AgentActivityEvent } from "./types";

/** UUID that works in both the Node runtime and the browser bundle. */
export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback: RFC-4122-ish, sufficient for event correlation.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Phrases that would leak hidden reasoning — stripped from any public text. */
const BLOCKED_PHRASES = [
  "chain of thought",
  "chain-of-thought",
  "hidden reasoning",
  "internal reasoning",
  "scratchpad",
  "private reasoning",
  "let me think",
  "thinking:",
  "تفكيري الداخلي",
  "سلسلة التفكير",
  "أفكر داخلياً",
  "أفكر داخليا",
  "تفكير داخلي",
];

/**
 * Remove any blocked chain-of-thought phrasing and cap length. Used on both
 * activity messages and any public model text before display.
 */
export function sanitizeActivityMessage(message: string): string {
  let clean = neutralizeDataVendor(String(message ?? "").trim());
  for (const phrase of BLOCKED_PHRASES) {
    clean = clean.replace(new RegExp(escapeRegExp(phrase), "gi"), "");
  }
  return clean.replace(/\s{2,}/g, " ").trim().slice(0, 240);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The market-data vendor is internal provenance — operator instruction: the
 * data source must never appear in user-facing output on any surface. The
 * prompt layer already forbids naming it; this is the outbound guarantee for
 * text a model composed anyway. Exchange-prefixed symbols ("OANDA:XAUUSD")
 * drop the prefix; prose mentions become the neutral "platform feed" phrase
 * in the text's own language.
 */
function neutralizeDataVendor(text: string): string {
  const out = text.replace(/\bOANDA:\s*/g, "");
  return out.replace(/\bOANDA\b|أواندا|آواندا|اواندا/g, () => (/[\u0600-\u06FF]/.test(out) ? "تغذية المنصة" : "the platform feed"));
}

/** Build a complete, sanitized, timestamped activity event. */
export function createActivityEvent(
  event: Omit<AgentActivityEvent, "id" | "timestamp">,
): AgentActivityEvent {
  return {
    id: newId(),
    timestamp: Date.now(),
    ...event,
    message: sanitizeActivityMessage(event.message),
  };
}

/**
 * Gate applied before an activity event reaches the UI. Only real tool/agent
 * work is shown: events explicitly marked `visible: false` and empty messages
 * are suppressed. Scripted intent-narration was removed from the SOURCE (not
 * merely filtered) — a repo-scan test enforces it never comes back.
 */
export function shouldShowActivity(event: AgentActivityEvent): boolean {
  if (event.visible === false) return false;
  if (!event.message.trim()) return false;
  return true;
}

/**
 * Like sanitizeActivityMessage but WITHOUT the 240-char cap — for full public
 * answers/summaries where truncation would drop legitimate content.
 */
export function sanitizePublicText(text: string): string {
  let clean = neutralizeDataVendor(String(text ?? "").trim());
  for (const phrase of BLOCKED_PHRASES) {
    clean = clean.replace(new RegExp(escapeRegExp(phrase), "gi"), "");
  }
  return clean.replace(/[ \t]{2,}/g, " ").trim();
}
