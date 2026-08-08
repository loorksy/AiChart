"use client";

/**
 * Composer Coach (plan Feature B) — rendered above the composer textarea
 * whenever the latest assistant turn carries a guided `generate_strategy`
 * wizard step. Icon badge + title + description, pill suggestion chips that
 * populate the composer's draft text (never auto-send), and a persistent
 * cancel button that sends the cancel keyword directly. `DESIGN.md`
 * conformance: `Surface`, semantic tokens only, `rounded-full` pill chips
 * matching the existing quick-start button pattern in `QuantAgentChatPanel`.
 */
import { Sparkles, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { Surface } from "@/components/foundation";
import { Button } from "@/components/squareui/button";
import type { ComposerCoach } from "@/lib/agent/quantAgentChat/types";

export interface QuantAgentComposerCoachProps {
  coach: ComposerCoach;
  onSuggestionClick: (value: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function QuantAgentComposerCoach({
  coach,
  onSuggestionClick,
  onCancel,
  disabled,
}: QuantAgentComposerCoachProps) {
  const { t, dir } = useLocale();

  return (
    <Surface padding="sm" className="mb-2">
      <div dir={dir} className="space-y-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted/40">
            <Sparkles className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{coach.title}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-muted-foreground">{coach.description}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            disabled={disabled}
            aria-label={t("qa.chat.coach.cancel_button")}
            title={t("qa.chat.coach.cancel_button")}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>

        {coach.suggestions.length ? (
          <div className="flex flex-wrap items-center gap-1.5 ps-8">
            {coach.suggestions.map((suggestion) => (
              <button
                key={suggestion.value}
                type="button"
                disabled={disabled}
                onClick={() => onSuggestionClick(suggestion.value)}
                className="min-h-9 rounded-full border border-border bg-background px-3 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Surface>
  );
}
