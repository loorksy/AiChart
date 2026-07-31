"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, KeyRound, RefreshCw } from "lucide-react";
import { OpenAIModelPicker } from "@/components/admin/OpenAIModelPicker";
import { cn } from "@/lib/utils";

type ConfigField = {
  key: string;
  label: string;
  labelEn: string;
  group: "core" | "ai" | "telegram" | "ops";
  type?: "text" | "url" | "toggle";
  placeholder?: string;
  configured: boolean;
  source: "db" | "env" | null;
  masked?: string;
  value?: string;
  secret?: boolean;
};

const GROUPS: { id: ConfigField["group"]; title: string }[] = [
  { id: "core", title: "الأساس والأمان" },
  { id: "ai", title: "الذكاء الاصطناعي — المزوّد والنماذج" },
  { id: "telegram", title: "تليجرام" },
  { id: "ops", title: "التشغيل والمراقبة" },
];

/** Fixed Claude catalog offered by the platform (id → label). */
const ANTHROPIC_MODELS: { id: string; label: string }[] = [
  { id: "claude-fable-5", label: "Claude Fable 5" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
];

const PROVIDERS: { id: string; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic (Claude)" },
];

export function AdminKeysPanel() {
  const [fields, setFields] = useState<ConfigField[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [agentModel, setAgentModel] = useState<{
    platformRef: string;
    fallbacks: string[];
  } | null>(null);

  const loadAgentModelStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/agent-model-status", {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setAgentModel(data);
    } catch {
      setAgentModel(null);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes] = await Promise.all([
        fetch("/api/admin/config"),
        loadAgentModelStatus(),
      ]);
      const data = await configRes.json();
      if (configRes.ok) setFields(data.fields);
    } finally {
      setLoading(false);
    }
  }, [loadAgentModelStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  function setDraftValue(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(draft)) {
      if (value.trim()) patch[key] = value.trim();
    }
    if (Object.keys(patch).length === 0) {
      setMsg({ type: "err", text: "أدخل قيمة واحدة على الأقل للحفظ." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "فشل الحفظ." });
        return;
      }
      setFields(data.fields);
      setDraft({});
      await loadAgentModelStatus();
      setMsg({
        type: "ok",
        text: "تم حفظ المفاتيح — المنصة و MCP يستخدمان المزوّد والنموذج المحدّدين هنا.",
      });
    } finally {
      setSaving(false);
    }
  }

  const configuredCount = fields.filter((f) => f.configured).length;

  const apiKeyField = fields.find((f) => f.key === "OPENAI_API_KEY");
  const aiModelField = fields.find((f) => f.key === "AI_MODEL");
  const currentAiModel = aiModelField?.value ?? "gpt-4.1";
  const realtimeModelField = fields.find(
    (f) => f.key === "OPENAI_REALTIME_MODEL",
  );
  const currentRealtimeModel = realtimeModelField?.value ?? "gpt-realtime";
  const providerField = fields.find((f) => f.key === "AI_PROVIDER");
  const anthropicKeyField = fields.find((f) => f.key === "ANTHROPIC_API_KEY");
  const anthropicModelField = fields.find((f) => f.key === "ANTHROPIC_MODEL");
  const activeProvider =
    (draft.AI_PROVIDER ?? providerField?.value ?? "openai") === "anthropic"
      ? "anthropic"
      : "openai";
  const currentAnthropicModel =
    draft.ANTHROPIC_MODEL ?? anthropicModelField?.value ?? "claude-opus-5";

  const aiExtraFields = fields.filter(
    (f) =>
      f.group === "ai" &&
      f.key !== "OPENAI_API_KEY" &&
      f.key !== "AI_MODEL" &&
      f.key !== "OPENAI_REALTIME_MODEL" &&
      f.key !== "AI_PROVIDER" &&
      f.key !== "ANTHROPIC_API_KEY" &&
      f.key !== "ANTHROPIC_MODEL",
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <KeyRound className="h-5 w-5 text-primary" />
            المفاتيح والإعدادات
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ضع مفتاح OpenAI والنموذج من لوحة الإدارة — تُخزَّن مشفّرة في قاعدة
            البيانات. القيم من <code dir="ltr">.env</code> تبقى احتياطاً.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          تحديث
        </button>
      </div>

      <div className="admin-card flex items-center gap-3 p-4 text-sm">
        <span className="text-muted-foreground">الحالة:</span>
        <span className="font-semibold text-primary">
          {configuredCount}/{fields.length} مُعدّ
        </span>
      </div>

      {GROUPS.map((group) => {
        const groupFields =
          group.id === "ai"
            ? aiExtraFields
            : fields.filter((f) => f.group === group.id);
        if (!groupFields.length && group.id !== "ai") return null;
        if (group.id === "ai" && !apiKeyField) return null;
        return (
          <section key={group.id} className="admin-card p-4">
            <h3 className="mb-4 font-bold text-foreground">{group.title}</h3>
            <div className="space-y-4">
              {group.id === "ai" && apiKeyField && (
                <>
                  {/* Active provider — which brain answers the platform. */}
                  <div>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        مزوّد الذكاء الاصطناعي النشط
                        <span className="mr-2 text-[10px] text-muted-foreground" dir="ltr">
                          AI_PROVIDER
                        </span>
                      </span>
                    </div>
                    <div className="inline-flex gap-1 rounded-lg border border-border bg-card p-1">
                      {PROVIDERS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setDraftValue("AI_PROVIDER", p.id)}
                          className={cn(
                            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                            activeProvider === p.id
                              ? "bg-foreground text-background"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ConfigFieldRow
                    f={apiKeyField}
                    draft={draft}
                    setDraftValue={setDraftValue}
                  />
                  <OpenAIModelPicker
                    apiKeyDraft={draft.OPENAI_API_KEY ?? ""}
                    apiKeyConfigured={apiKeyField.configured}
                    currentModel={currentAiModel}
                    draftModel={draft.AI_MODEL ?? ""}
                    onSelectModel={(id) => setDraftValue("AI_MODEL", id)}
                  />
                  <OpenAIModelPicker
                    apiKeyDraft={draft.OPENAI_API_KEY ?? ""}
                    apiKeyConfigured={apiKeyField.configured}
                    currentModel={currentRealtimeModel}
                    draftModel={draft.OPENAI_REALTIME_MODEL ?? ""}
                    onSelectModel={(id) =>
                      setDraftValue("OPENAI_REALTIME_MODEL", id)
                    }
                    endpoint="/api/admin/config/voice-models"
                    title="نموذج المحادثة الصوتية (Realtime)"
                    emptyHint="أدخل مفتاح OpenAI أعلاه لعرض نماذج المحادثة الصوتية المتاحة."
                    loadingHint="جارٍ جلب نماذج المحادثة الصوتية من OpenAI…"
                  />
                  {anthropicKeyField && (
                    <ConfigFieldRow
                      f={anthropicKeyField}
                      draft={draft}
                      setDraftValue={setDraftValue}
                    />
                  )}
                  {anthropicModelField && (
                    <div>
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <label className="text-sm font-medium" htmlFor="ANTHROPIC_MODEL">
                          نموذج Claude
                          <span className="mr-2 text-[10px] text-muted-foreground" dir="ltr">
                            ANTHROPIC_MODEL
                          </span>
                        </label>
                      </div>
                      <select
                        id="ANTHROPIC_MODEL"
                        dir="ltr"
                        className="admin-input w-full text-sm"
                        value={currentAnthropicModel}
                        onChange={(e) => setDraftValue("ANTHROPIC_MODEL", e.target.value)}
                      >
                        {ANTHROPIC_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label} — {m.id}
                          </option>
                        ))}
                        {!ANTHROPIC_MODELS.some((m) => m.id === currentAnthropicModel) && (
                          <option value={currentAnthropicModel}>{currentAnthropicModel}</option>
                        )}
                      </select>
                    </div>
                  )}
                  {agentModel && (
                    <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
                      نموذج المنصة (MCP):{" "}
                      <code dir="ltr">{agentModel.platformRef}</code>
                      {agentModel.fallbacks.length > 0 && (
                        <>
                          {" · "}
                          fallbacks:{" "}
                          <code dir="ltr">
                            {agentModel.fallbacks.join(", ")}
                          </code>
                        </>
                      )}
                    </p>
                  )}
                </>
              )}
              {groupFields.map((f) => (
                <ConfigFieldRow
                  key={f.key}
                  f={f}
                  draft={draft}
                  setDraftValue={setDraftValue}
                />
              ))}
            </div>
          </section>
        );
      })}

      {msg && (
        <p
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            msg.type === "ok"
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {msg.text}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          {saving ? "جارٍ الحفظ…" : "حفظ المفاتيح"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        تحذير: تغيير <span dir="ltr">ENCRYPTION_KEY</span> بعد ربط حسابات MetaTrader
        يمنع فك تشفير المفاتيح القديمة. غيّره فقط عند بداية التشغيل.
      </p>
    </div>
  );
}

function ConfigFieldRow({
  f,
  draft,
  setDraftValue,
}: {
  f: ConfigField;
  draft: Record<string, string>;
  setDraftValue: (key: string, value: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium" htmlFor={f.key}>
          {f.label}
          <span className="mr-2 text-[10px] text-muted-foreground" dir="ltr">
            {f.labelEn}
          </span>
        </label>
        <StatusBadge field={f} />
      </div>

      {f.type === "toggle" ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={
              (draft[f.key] ?? f.value ?? "0") === "1" || f.value === "1"
            }
            onChange={(e) =>
              setDraftValue(f.key, e.target.checked ? "1" : "0")
            }
          />
          مفعّل
        </label>
      ) : (
        <>
          {f.configured && f.masked && (
            <p className="mb-1 text-xs text-muted-foreground" dir="ltr">
              الحالي: {f.masked}
            </p>
          )}
          {!f.configured && f.value && (
            <p className="mb-1 text-xs text-muted-foreground" dir="ltr">
              {f.value}
            </p>
          )}
          <input
            id={f.key}
            type={
              f.type === "url" ? "url" : f.secret ? "password" : "text"
            }
            className="admin-input w-full text-sm"
            dir="ltr"
            placeholder={
              draft[f.key] ? undefined : f.placeholder ?? "أدخل قيمة جديدة…"
            }
            value={draft[f.key] ?? ""}
            onChange={(e) => setDraftValue(f.key, e.target.value)}
            autoComplete="off"
          />
        </>
      )}
    </div>
  );
}

function StatusBadge({ field }: { field: ConfigField }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium",
        field.configured
          ? "bg-green-500/15 text-green-600 dark:text-green-400"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {field.configured ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <Circle className="h-3 w-3" />
      )}
      {field.configured
        ? field.source === "db"
          ? "محفوظ"
          : ".env"
        : "غير مُعدّ"}
    </span>
  );
}
