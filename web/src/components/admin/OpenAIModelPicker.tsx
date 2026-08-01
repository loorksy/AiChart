"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";

import { Button } from "@/components/squareui/button";
import { cn } from "@/lib/utils";
import { InlineAlert, Spinner } from "@/components/admin/ui/AdminKit";

export interface OpenAIModelOption {
  id: string;
  display_name: string;
  created_at?: string;
  max_input_tokens?: number;
}

export function OpenAIModelPicker({
  apiKeyDraft,
  apiKeyConfigured,
  currentModel,
  draftModel,
  onSelectModel,
  endpoint = "/api/admin/config/models",
  title = "النموذج الافتراضي",
  emptyHint = "أدخل مفتاح OpenAI أعلاه لعرض النماذج المتاحة.",
  loadingHint = "جارٍ جلب النماذج من OpenAI…",
}: {
  apiKeyDraft: string;
  apiKeyConfigured: boolean;
  currentModel: string;
  draftModel: string;
  onSelectModel: (modelId: string) => void;
  endpoint?: string;
  title?: string;
  emptyHint?: string;
  loadingHint?: string;
}) {
  const [models, setModels] = useState<OpenAIModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const selected = draftModel || currentModel;
  const canFetch = apiKeyConfigured || apiKeyDraft.trim().length >= 10;

  const fetchModels = useCallback(async () => {
    if (!canFetch) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر جلب النماذج — تأكّد من صلاحية المفتاح.");
        setModels([]);
        return;
      }
      setModels(data.models ?? []);
      setFetched(true);
      const hasDefault = data.defaultModel || currentModel;
      if (
        !draftModel &&
        hasDefault &&
        data.models?.some((m: OpenAIModelOption) => m.id === hasDefault)
      ) {
        onSelectModel(hasDefault);
      } else if (!draftModel && data.models?.[0]?.id) {
        onSelectModel(data.models[0].id);
      }
    } catch {
      setError("تعذّر الاتصال بالخادم — لم تُجلب أي نماذج.");
    } finally {
      setLoading(false);
    }
  }, [apiKeyDraft, canFetch, currentModel, draftModel, endpoint, onSelectModel]);

  useEffect(() => {
    if (apiKeyConfigured && !fetched && !apiKeyDraft.trim()) {
      void fetchModels();
    }
  }, [apiKeyConfigured, fetched, apiKeyDraft, fetchModels]);

  useEffect(() => {
    if (apiKeyDraft.trim().length >= 10) {
      setFetched(false);
      setModels([]);
    }
  }, [apiKeyDraft]);

  if (!canFetch) {
    return <p className="text-xs text-muted-foreground">{emptyHint}</p>;
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="size-4 text-primary" aria-hidden />
          {title}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="tap-target"
          onClick={() => void fetchModels()}
          disabled={loading}
        >
          {loading ? <Spinner /> : null}
          {loading ? "جارٍ التحميل…" : "تحديث القائمة"}
        </Button>
      </div>

      {selected && (
        <p className="text-xs text-muted-foreground">
          المختار:{" "}
          <span className="type-numeric text-foreground" dir="ltr">
            {selected}
          </span>
        </p>
      )}

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {!fetched && !loading && apiKeyDraft.trim() && (
        <Button
          type="button"
          variant="secondary"
          className="tap-target h-10 w-full"
          onClick={() => void fetchModels()}
        >
          جلب النماذج المتاحة
        </Button>
      )}

      {loading && models.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {loadingHint}
        </p>
      )}

      {models.length > 0 && (
        <ul
          role="radiogroup"
          aria-label={title}
          className="max-h-64 space-y-1.5 overflow-y-auto"
        >
          {models.map((m) => {
            const isSelected = selected === m.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => onSelectModel(m.id)}
                  className={cn(
                    "focus-ring tap-target flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-start transition-colors duration-150 ease-out",
                    isSelected
                      ? "border-primary/50 bg-primary/10"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {isSelected && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {m.display_name}
                    </span>
                    <span
                      className="type-numeric block text-start text-[10px] text-muted-foreground"
                      dir="ltr"
                    >
                      {m.id}
                      {m.max_input_tokens
                        ? ` · ${(m.max_input_tokens / 1000).toFixed(0)}k tokens`
                        : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
