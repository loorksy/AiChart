/**
 * The always-shown transparency line: what the agent's eyes actually did.
 *
 * Every recommendation states its visual basis, in BOTH states — "the agent
 * reviewed its own TradingView chart with the drawings rendered" or "no
 * chart was reviewed; this is numeric analysis only". The line is never
 * omitted and never softened: an operator who cannot tell a visually
 * reviewed plan from a numbers-only one can trust neither.
 */
import { t } from "@/lib/i18n";
import type { AppLocale } from "@/lib/i18n";
import type { VisualConfirmation } from "./visualConfirmation";

export interface VisualTransparencyInput {
  state: VisualConfirmation;
  timeframesReviewed?: string[];
}

/** One sentence, present in both states. */
export function visualTransparencyLine(
  input: VisualTransparencyInput,
  locale: AppLocale = "ar",
): string {
  if (input.state === "confirmed") {
    const frames = (input.timeframesReviewed ?? []).join(t(locale, "list.separator"));
    return frames
      ? t(locale, "visual.line.reviewed_frames", { frames })
      : t(locale, "visual.line.reviewed");
  }
  if (input.state === "contradicted") {
    return t(locale, "visual.line.contradicted_plain");
  }
  return t(locale, "visual.line.not_reviewed");
}
