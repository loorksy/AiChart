"use client";

import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "@/components/agent/ProviderIcon";

interface ModelOption {
  ref: string;
  provider: "openai" | "anthropic";
  model: string;
  label: string;
}

interface ModelsResponse {
  models: ModelOption[];
  selected: string | null;
  platformDefault: string;
  configured: boolean;
}

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/**
 * The user's own model choice.
 *
 * The operator supplies API keys; which brain answers is the user's call, so
 * the control lives with the message box rather than in an admin panel — now
 * one section of the composer's options menu, since a permanently visible
 * model chip was one control too many on a phone-width row.
 *
 * Loads on demand: `enabled` is the menu's open state, so a console that never
 * opens the menu never asks for the catalogue.
 */
export function useAgentModels(enabled: boolean) {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled || data) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/agent/models", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as ModelsResponse;
        if (alive) setData(json);
      } catch {
        /* the section simply stays hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, data]);

  const choose = useCallback(async (ref: string | null) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferred_model_ref: ref }),
      });
      if (res.ok) setData((prev) => (prev ? { ...prev, selected: ref } : prev));
      return res.ok;
    } finally {
      setSaving(false);
    }
  }, []);

  const activeRef = data ? (data.selected ?? data.platformDefault) : null;
  const activeLabel = data
    ? (data.models.find((m) => m.ref === activeRef)?.label ??
      activeRef?.split("/").pop() ??
      activeRef)
    : null;

  return {
    data,
    saving,
    choose,
    activeLabel,
    /** Nothing to offer when no provider key is configured. */
    available: Boolean(data?.configured) && (data?.models.length ?? 0) > 0,
  };
}

const ROW_CLASS =
  "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-start text-xs transition-colors hover:bg-muted sm:min-h-10";

/** The model list itself, rendered inside whatever surface hosts it. */
export function ModelChoiceList({
  models,
  selected,
  saving,
  onChoose,
}: {
  models: ModelOption[];
  selected: string | null;
  saving: boolean;
  onChoose: (ref: string | null) => void;
}) {
  const { t } = useLocale();
  const grouped = models.reduce<Record<string, ModelOption[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div>
      <button
        type="button"
        disabled={saving}
        onClick={() => onChoose(null)}
        className={cn(ROW_CLASS, !selected && "font-semibold")}
      >
        <span>{t("model.platform_default")}</span>
        {!selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      </button>
      {Object.entries(grouped).map(([provider, options]) => (
        <div key={provider}>
          <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ProviderIcon provider={provider} size={12} />
            {PROVIDER_LABEL[provider] ?? provider}
          </p>
          {options.map((m) => (
            <button
              key={m.ref}
              type="button"
              disabled={saving}
              onClick={() => onChoose(m.ref)}
              className={cn(ROW_CLASS, selected === m.ref && "font-semibold")}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <ProviderIcon
                  provider={provider}
                  size={13}
                  className="text-muted-foreground"
                />
                <span className="truncate" dir="ltr">
                  {m.label}
                </span>
              </span>
              {selected === m.ref && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
