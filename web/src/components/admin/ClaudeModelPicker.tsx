"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ClaudeModelOption {
  id: string;
  display_name: string;
  created_at?: string;
  max_input_tokens?: number;
}

export function ClaudeModelPicker({
  apiKeyDraft,
  apiKeyConfigured,
  currentModel,
  draftModel,
  onSelectModel,
}: {
  apiKeyDraft: string;
  apiKeyConfigured: boolean;
  currentModel: string;
  draftModel: string;
  onSelectModel: (modelId: string) => void;
}) {
  const [models, setModels] = useState<ClaudeModelOption[]>([]);
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
      const res = await fetch("/api/admin/config/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر جلب النماذج.");
        setModels([]);
        return;
      }
      setModels(data.models ?? []);
      setFetched(true);
      const hasDefault = data.defaultModel || currentModel;
      if (!draftModel && hasDefault && data.models?.some((m: ClaudeModelOption) => m.id === hasDefault)) {
        onSelectModel(hasDefault);
      } else if (!draftModel && data.models?.[0]?.id) {
        onSelectModel(data.models[0].id);
      }
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }, [apiKeyDraft, canFetch, currentModel, draftModel, onSelectModel]);

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
    return (
      <p className="text-xs text-muted-foreground">
        أدخل مفتاح Claude أعلاه لعرض النماذج المتاحة.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">النموذج الافتراضي</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchModels()}
          disabled={loading}
          className="rounded-lg border border-white/10 px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {loading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              جارٍ التحميل…
            </span>
          ) : (
            "تحديث القائمة"
          )}
        </button>
      </div>

      {selected && (
        <p className="text-xs text-muted-foreground">
          المختار: <span className="text-primary" dir="ltr">{selected}</span>
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {!fetched && !loading && apiKeyDraft.trim() && (
        <button
          type="button"
          onClick={() => void fetchModels()}
          className="w-full rounded-lg bg-primary/15 py-2 text-sm font-medium text-primary"
        >
          جلب النماذج المتاحة
        </button>
      )}

      {loading && models.length === 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          جارٍ جلب النماذج من Anthropic…
        </p>
      )}

      {models.length > 0 && (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto">
          {models.map((m) => {
            const isSelected = selected === m.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onSelectModel(m.id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-right transition",
                    isSelected
                      ? "border-primary/50 bg-primary/10"
                      : "border-white/5 hover:border-white/15 hover:bg-white/5",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-white/20",
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {m.display_name}
                    </span>
                    <span className="block text-[10px] text-muted-foreground" dir="ltr">
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
