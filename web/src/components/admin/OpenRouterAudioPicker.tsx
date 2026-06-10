"use client";

import { useCallback, useState } from "react";
import { Check, Loader2, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioModelOption {
  id: string;
  name: string;
}

/** Picks the OpenRouter audio-input model used for voice-note transcription. */
export function OpenRouterAudioPicker({
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
  const [models, setModels] = useState<AudioModelOption[]>([]);
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
      const res = await fetch("/api/admin/config/openrouter-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {},
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "تعذّر جلب النماذج.");
        setModels([]);
        return;
      }
      setModels(data.models ?? []);
      setFetched(true);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }, [apiKeyDraft, canFetch]);

  if (!canFetch) {
    return (
      <p className="text-xs text-muted-foreground">
        أدخل مفتاح OpenRouter أعلاه لعرض نماذج الصوت المتاحة.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Mic className="h-4 w-4 text-primary" />
          نموذج تفريغ الرسائل الصوتية
        </p>
        <button
          type="button"
          onClick={() => void fetchModels()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {fetched ? "تحديث القائمة" : "جلب النماذج"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {selected && (
        <p className="text-xs text-muted-foreground" dir="ltr">
          الحالي: {selected}
        </p>
      )}

      {models.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {models.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelectModel(m.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-xs transition",
                  selected === m.id
                    ? "bg-primary/15 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <span className="min-w-0 truncate" dir="ltr">
                  {m.id}
                </span>
                {selected === m.id && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {fetched && models.length === 0 && !error && (
        <p className="text-xs text-muted-foreground">
          لا نماذج تدعم الصوت على هذا المفتاح.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        اختر النموذج ثم اضغط «حفظ المفاتيح». الوكيل يستخدمه عبر{" "}
        <code dir="ltr">/api/agent/transcribe</code>.
      </p>
    </div>
  );
}
