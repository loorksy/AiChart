"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

type PublicModel = {
  id: string;
  displayName: string;
  supportedReasoningValues: Array<"high" | "medium" | "low">;
  vision: boolean;
  eligibleAsDefault: boolean;
  reasoningAdjustable: boolean;
};

type ModelsResponse = {
  models: PublicModel[];
  preferredModelId: string | null;
  preferredReasoningEffort: "high" | "medium" | "low" | null;
  defaultModelId: string | null;
};

const EFFORT_LABEL: Record<"high" | "medium" | "low", { ar: string; en: string }> = {
  high: { ar: "عالي", en: "High" },
  medium: { ar: "متوسط", en: "Medium" },
  low: { ar: "منخفض", en: "Low" },
};

export function ModelReasoningSelector({ disabled }: { disabled?: boolean }) {
  const { t, locale } = useLocale();
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/models", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as ModelsResponse;
      setData(json);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected =
    data?.models.find((m) => m.id === data.preferredModelId) ??
    data?.models.find((m) => m.id === data.defaultModelId) ??
    data?.models[0];

  async function persist(patch: {
    modelId?: string;
    reasoningEffort?: "high" | "medium" | "low";
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

  if (!data?.models.length || !selected) return null;

  const efforts = selected.supportedReasoningValues;
  const showReasoning = selected.reasoningAdjustable && efforts.length > 0;
  const fixedHigh =
    !selected.reasoningAdjustable &&
    efforts.length === 1 &&
    efforts[0] === "high";

  return (
    <div
      className="mb-1 flex max-w-full flex-wrap items-center gap-1.5 px-1"
      data-testid="model-reasoning-selector"
    >
      <label className="sr-only" htmlFor="composer-model">
        {t("agent.model_label")}
      </label>
      <select
        id="composer-model"
        disabled={disabled || saving}
        value={selected.id}
        onChange={(e) => void persist({ modelId: e.target.value })}
        className={cn(
          "max-w-[9.5rem] truncate rounded-md border border-white/10 bg-transparent px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none",
          "hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
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
          <label className="sr-only" htmlFor="composer-reasoning">
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
                reasoningEffort: e.target.value as "high" | "medium" | "low",
              })
            }
            className={cn(
              "rounded-md border border-white/10 bg-transparent px-1.5 py-0.5 text-[11px] text-muted-foreground outline-none",
              "hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
            )}
            aria-label={t("agent.reasoning_label")}
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
        <span className="text-[10px] text-muted-foreground">
          {locale === "en" ? "High" : "عالي"}
        </span>
      )}

      {!efforts.length && (
        <span className="text-[10px] text-muted-foreground">
          {t("agent.reasoning_fixed")}
        </span>
      )}

      {error && (
        <span className="text-[10px] text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
