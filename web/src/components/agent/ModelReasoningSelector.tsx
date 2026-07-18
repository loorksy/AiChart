"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";
import type { ReasoningEffort } from "@/lib/agent/modelFirst/modelRegistry";

type PublicModel = {
  id: string;
  displayName: string;
  supportedReasoningValues: ReasoningEffort[];
  vision: boolean;
  eligibleAsDefault: boolean;
  reasoningAdjustable: boolean;
};

type ModelsResponse = {
  models: PublicModel[];
  preferredModelId: string | null;
  preferredReasoningEffort: ReasoningEffort | null;
  defaultModelId: string | null;
};

const EFFORT_LABEL: Record<ReasoningEffort, { ar: string; en: string }> = {
  high: { ar: "عالي", en: "High" },
  xhigh: { ar: "عالي جداً", en: "Extra high" },
  max: { ar: "أقصى", en: "Maximum" },
  medium: { ar: "متوسط", en: "Medium" },
  low: { ar: "منخفض", en: "Low" },
  minimal: { ar: "أدنى", en: "Minimal" },
  none: { ar: "بدون", en: "None" },
};

export function ModelReasoningSelector({ disabled }: { disabled?: boolean }) {
  const { t, locale } = useLocale();
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/agent/models", { cache: "no-store" });
      if (!res.ok) {
        setLoadError(t("agent.model_load_failed"));
        setData(null);
        return;
      }
      const json = (await res.json()) as ModelsResponse;
      setData(json);
    } catch {
      setLoadError(t("agent.model_load_failed"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected =
    data?.models.find((m) => m.id === data.preferredModelId) ??
    data?.models.find((m) => m.id === data.defaultModelId) ??
    data?.models[0];

  async function persist(patch: {
    modelId?: string;
    reasoningEffort?: ReasoningEffort;
  }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/models/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof json.error === "string"
            ? json.error
            : t("agent.model_save_failed"),
        );
        return;
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              preferredModelId: json.preferredModelId ?? prev.preferredModelId,
              preferredReasoningEffort:
                json.preferredReasoningEffort ?? prev.preferredReasoningEffort,
            }
          : prev,
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div
        className="mb-1 px-1 text-[11px] text-muted-foreground"
        data-testid="model-reasoning-selector-loading"
      >
        {t("agent.model_loading")}
      </div>
    );
  }

  if (loadError || !data?.models.length || !selected) {
    return (
      <div
        className="mb-1 flex flex-wrap items-center gap-2 px-1 text-[11px] text-muted-foreground"
        data-testid="model-reasoning-selector-empty"
      >
        <span>{loadError ?? t("agent.model_unavailable")}</span>
        <button
          type="button"
          onClick={() => void load()}
          className="underline hover:text-foreground"
        >
          {t("agent.model_retry")}
        </button>
      </div>
    );
  }

  const efforts = selected.supportedReasoningValues;
  const showReasoning = selected.reasoningAdjustable && efforts.length > 0;
  const fixedHigh =
    !selected.reasoningAdjustable &&
    efforts.length === 1 &&
    efforts[0] === "high";

  return (
    <div
      className="mb-1.5 flex max-w-full flex-wrap items-center gap-2 px-1"
      data-testid="model-reasoning-selector"
    >
      <label
        className="text-[11px] text-muted-foreground"
        htmlFor="composer-model"
      >
        {t("agent.model_label")}
      </label>
      <select
        id="composer-model"
        disabled={disabled || saving}
        value={selected.id}
        onChange={(e) => void persist({ modelId: e.target.value })}
        className={cn(
          "max-w-[11rem] truncate rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none",
          "hover:border-foreground/30 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
        )}
        aria-label={t("agent.model_label")}
        title={t("agent.model_hint")}
      >
        {data.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName}
          </option>
        ))}
      </select>

      {showReasoning && (
        <>
          <label
            className="text-[11px] text-muted-foreground"
            htmlFor="composer-reasoning"
          >
            {t("agent.reasoning_label")}
          </label>
          <select
            id="composer-reasoning"
            disabled={disabled || saving}
            value={
              data.preferredReasoningEffort &&
              efforts.includes(data.preferredReasoningEffort)
                ? data.preferredReasoningEffort
                : efforts.includes("high")
                  ? "high"
                  : efforts[0]!
            }
            onChange={(e) =>
              void persist({
                reasoningEffort: e.target.value as ReasoningEffort,
              })
            }
            className={cn(
              "rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none",
              "hover:border-foreground/30 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
            )}
            aria-label={t("agent.reasoning_label")}
            title={t("agent.reasoning_hint")}
          >
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {locale === "en"
                  ? EFFORT_LABEL[effort].en
                  : EFFORT_LABEL[effort].ar}
              </option>
            ))}
          </select>
        </>
      )}

      {fixedHigh && (
        <span className="text-[11px] text-muted-foreground">
          {locale === "en" ? "High" : "عالي"}
        </span>
      )}

      {!efforts.length && (
        <span className="text-[11px] text-muted-foreground">
          {t("agent.reasoning_fixed")}
        </span>
      )}

      {error && (
        <span className="text-[11px] text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
