"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, ChevronDown, LineChart, MessageCircle, Plus, Send, TrendingUp } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { LANDING_ROUTES } from "@/components/landing/landingCopy";
import { ProviderIcon } from "@/components/agent/ProviderIcon";
import {
  ANTHROPIC_MODEL_CHOICES,
  PLATFORM_DEFAULT_MODEL_ID,
  shortModelLabel,
} from "@/lib/modelCatalog";
import { cn } from "@/lib/utils";

const DEFAULT_MODEL =
  ANTHROPIC_MODEL_CHOICES.find((m) => m.id === PLATFORM_DEFAULT_MODEL_ID) ??
  ANTHROPIC_MODEL_CHOICES[0]!;

const MODEL_LABEL = shortModelLabel(DEFAULT_MODEL.label);

const PILLS = [
  { id: "gold", icon: LineChart, labelKey: "landing.pill.gold", promptKey: "landing.prompt.gold" },
  {
    id: "recommend",
    icon: TrendingUp,
    labelKey: "landing.pill.recommend",
    promptKey: "landing.prompt.recommend",
  },
  {
    id: "telegram",
    icon: MessageCircle,
    labelKey: "landing.pill.telegram",
    promptKey: "landing.prompt.telegram",
  },
  {
    id: "performance",
    icon: BarChart3,
    labelKey: "landing.pill.performance",
    promptKey: "landing.prompt.performance",
  },
] as const;

/** Unauthenticated landing continues through /chat, which redirects to login. */
function continueHref(): string {
  return LANDING_ROUTES.console;
}

export function LandingComposer() {
  const { t, dir } = useLocale();
  const router = useRouter();
  const [value, setValue] = useState("");

  const go = useCallback(
    (text?: string) => {
      const next = (text ?? value).trim();
      if (!next) return;
      router.push(continueHref());
    },
    [router, value],
  );

  return (
    <div className="flex w-full max-w-xl flex-col items-stretch gap-3 sm:max-w-2xl">
      <form
        data-testid="landing-composer"
        dir={dir}
        className="landing-composer-glass flex flex-col rounded-3xl px-4 pb-3 pt-4 sm:px-5 sm:pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
      >
        <textarea
          data-testid="landing-composer-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
              return;
            }
            event.preventDefault();
            go();
          }}
          rows={2}
          placeholder={t("landing.composer.placeholder")}
          aria-label={t("landing.composer.placeholder")}
          className="min-h-12 w-full resize-none bg-transparent text-base leading-6 text-white outline-none placeholder:text-white/45 sm:min-h-14"
        />

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled
            data-testid="landing-composer-plus"
            aria-label={t("landing.composer.plus")}
            title={t("landing.composer.plus_unavailable")}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/20 text-white/70 opacity-60"
          >
            <Plus className="size-4" strokeWidth={2.25} aria-hidden />
          </button>

          <div
            data-testid="landing-composer-model"
            className="inline-flex min-w-0 max-w-[11.5rem] items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-white"
            aria-label={`${t("landing.composer.model")}: ${MODEL_LABEL}`}
          >
            <ProviderIcon
              provider="anthropic"
              model={DEFAULT_MODEL.id}
              size={13}
              className="shrink-0 text-white/85"
            />
            <span className="truncate text-xs font-medium" dir="ltr">
              {MODEL_LABEL}
            </span>
            <ChevronDown className="size-3 shrink-0 text-white/50" aria-hidden />
          </div>

          <button
            type="submit"
            data-testid="landing-composer-submit"
            disabled={!value.trim()}
            aria-label={t("landing.composer.submit")}
            className={cn(
              "ms-auto flex size-8 shrink-0 items-center justify-center rounded-full border border-white/20 text-white",
              value.trim() ? "bg-white/15" : "opacity-40",
            )}
          >
            <Send className="size-3.5" strokeWidth={2.25} aria-hidden />
          </button>
        </div>
      </form>

      <div
        data-testid="landing-pills"
        className="grid grid-cols-2 gap-2 sm:gap-2.5"
      >
        {PILLS.map((pill) => {
          const Icon = pill.icon;
          return (
            <button
              key={pill.id}
              type="button"
              data-testid={`landing-pill-${pill.id}`}
              onClick={() => setValue(t(pill.promptKey))}
              className="landing-pill inline-flex min-h-10 items-center gap-2 rounded-2xl px-3 py-2 text-start text-[11px] leading-snug text-white/90 sm:min-h-11 sm:text-xs"
            >
              <Icon className="size-3.5 shrink-0 text-white/75" aria-hidden />
              <span className="min-w-0 truncate">{t(pill.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
