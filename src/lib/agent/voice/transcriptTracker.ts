/**
 * Pure transcript handling for a voice session. Partial transcripts are UI-only;
 * only a non-empty FINAL transcript is submitted, and each final is submitted at
 * most once (dedup by stable event id, plus identical-text guard against
 * replayed provider events). Trading symbols are preserved verbatim — the text
 * is trimmed/whitespace-collapsed only, never case-folded or "corrected".
 */
import type { VoiceTranscriptEvent } from "./types";

/** Trim + collapse internal whitespace without altering symbols (XAUUSD, TP1…). */
export function normalizeTranscriptText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Empty or noise-only (no letters/digits in any script we care about). */
export function isEmptyTranscript(text: string): boolean {
  const t = normalizeTranscriptText(text);
  if (!t) return true;
  // Requires at least one Latin/Arabic LETTER or digit — pure punctuation (incl.
  // Arabic ؟ ،) or filler dots don't count as speech. Arabic letters live at
  // U+0621–U+064A, Arabic-Indic digits at U+0660–U+0669.
  return !/[0-9A-Za-zء-ي٠-٩]/.test(t);
}

export interface TranscriptOutcome {
  /** Live partial text to render (UI only, never persisted). */
  display?: string;
  /** A finalized user transcript to submit to the agent exactly once. */
  submit?: string;
}

export class TranscriptTracker {
  private readonly seenIds = new Set<string>();
  private lastSubmitted: string | null = null;

  handle(event: VoiceTranscriptEvent): TranscriptOutcome {
    const text = normalizeTranscriptText(event.text);

    if (!event.final) {
      // Partial: show it live if there's anything to show; never persist.
      return text ? { display: text } : {};
    }

    // Final: ignore replays of the same provider event.
    if (this.seenIds.has(event.id)) return {};
    this.seenIds.add(event.id);

    if (isEmptyTranscript(text)) return {};

    // Guard against a provider emitting the same final twice under new ids.
    if (text === this.lastSubmitted) return {};
    this.lastSubmitted = text;

    return { submit: text };
  }

  /** Reset for a brand-new session (so ids from a prior session don't linger). */
  reset(): void {
    this.seenIds.clear();
    this.lastSubmitted = null;
  }
}
