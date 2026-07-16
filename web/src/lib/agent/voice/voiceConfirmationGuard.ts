/**
 * Voice trading-safety guard. Voice never weakens execution confirmation: a
 * spoken affirmation only counts as a confirmation when it is bound to a pending
 * action that the authoritative AiChart agent actually proposed (requires
 * confirmation) for THIS user + chat, and only within a short expiry, and only
 * once per transcript event.
 *
 * This is defense-in-depth on the client — actual execution still flows through
 * the server-side execution guard, which independently requires confirmation.
 * Pure and DOM-free so every rule is unit-testable.
 */
import type { AppLocale } from "@/lib/i18n";

const AFFIRMATION_AR = [
  "نعم", "اجل", "أجل", "نفذ", "نفّذ", "اكد", "أكد", "أكّد", "اكّد",
  "موافق", "تمام", "اوكي", "أوكي", "تأكيد", "ايوه", "أيوه", "اي", "أي",
];
const AFFIRMATION_EN = [
  "yes", "execute", "confirm", "confirmed", "go ahead", "do it",
  "okay", "ok", "proceed", "affirmative",
];

/** True when the text is a plain affirmation (in either language). */
export function isAffirmationPhrase(text: string, locale: AppLocale): boolean {
  const t = text.toLowerCase().replace(/[.،,!؟?]/g, " ").trim();
  if (!t) return false;
  const words = new Set(t.split(/\s+/));
  const list = locale === "en" ? AFFIRMATION_EN : [...AFFIRMATION_AR, ...AFFIRMATION_EN];
  // Multi-word phrases ("go ahead", "do it") match on inclusion; single words
  // match on a whole-word basis so "yesterday" can't confirm a trade.
  return list.some((w) => (w.includes(" ") ? t.includes(w) : words.has(w)));
}

export type ConfirmationResolution =
  | "confirmed"
  | "expired"
  | "no_pending"
  | "duplicate"
  | "not_affirmation";

interface PendingConfirmation {
  userId: number;
  chatId: string;
  action: string;
  expiresAt: number;
}

export const DEFAULT_CONFIRMATION_TTL_MS = 90_000;

export class VoiceConfirmationGuard {
  private pending: PendingConfirmation | null = null;
  private readonly consumedTranscriptIds = new Set<string>();

  /** Arm a pending confirmation because AiChart asked the user to confirm. */
  arm(input: {
    userId: number;
    chatId: string;
    action: string;
    now: number;
    ttlMs?: number;
  }): void {
    this.pending = {
      userId: input.userId,
      chatId: input.chatId,
      action: input.action,
      expiresAt: input.now + (input.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS),
    };
  }

  /** Whether a live (unexpired) confirmation is currently armed. */
  hasPending(now: number): boolean {
    return this.pending != null && now <= this.pending.expiresAt;
  }

  pendingAction(): string | null {
    return this.pending?.action ?? null;
  }

  clear(): void {
    this.pending = null;
  }

  /**
   * Resolve a final user transcript against the pending confirmation. Returns
   * "confirmed" ONLY when a matching, unexpired, not-yet-consumed affirmation is
   * bound to the armed action. Consumes both the transcript id and the pending
   * action so a replay can never confirm a second time.
   */
  resolve(input: {
    userId: number;
    chatId: string;
    transcriptId: string;
    text: string;
    locale: AppLocale;
    now: number;
  }): ConfirmationResolution {
    if (this.consumedTranscriptIds.has(input.transcriptId)) return "duplicate";
    if (!isAffirmationPhrase(input.text, input.locale)) return "not_affirmation";
    const pending = this.pending;
    if (!pending || pending.userId !== input.userId || pending.chatId !== input.chatId) {
      return "no_pending";
    }
    if (input.now > pending.expiresAt) {
      this.pending = null;
      return "expired";
    }
    this.consumedTranscriptIds.add(input.transcriptId);
    this.pending = null;
    return "confirmed";
  }

  reset(): void {
    this.pending = null;
    this.consumedTranscriptIds.clear();
  }
}
