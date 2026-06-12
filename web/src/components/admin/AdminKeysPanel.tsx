"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, KeyRound, RefreshCw } from "lucide-react";
import { ClaudeModelPicker } from "@/components/admin/ClaudeModelPicker";
import { cn } from "@/lib/utils";

type ConfigField = {
  key: string;
  label: string;
  labelEn: string;
  group: "core" | "claude" | "telegram" | "ops";
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
  { id: "claude", title: "الذكاء الاصطناعي — المزود والنموذج" },
  { id: "telegram", title: "تليجرام" },
  { id: "ops", title: "التشغيل والمراقبة" },
];

export function AdminKeysPanel() {
  const [fields, setFields] = useState<ConfigField[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [agentModel, setAgentModel] = useState<{
    platformRef: string;
    gatewayPrimary: string | null;
    inSync: boolean;
    providerRegistered: boolean;
    gatewayConfigReadable: boolean;
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

  async function save(patchOverride?: Record<string, string>) {
    const patch: Record<string, string> = { ...patchOverride };
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
      const sync = data.agentModelSync as
        | {
            ok: boolean;
            ref?: string;
            restarted?: boolean;
            verified?: boolean;
            error?: string;
          }
        | undefined;
      if (sync?.ok) {
        setMsg({
          type: "ok",
          text:
            sync.verified
              ? `تم الحفظ — وكيل Telegram يعمل الآن على ${sync.ref} (لا حاجة لإعادة تشغيل يدوي).`
              : sync.restarted
                ? `تم الحفظ ومزامنة ${sync.ref} (أُعيد تشغيل Gateway).`
                : `تم الحفظ ومزامنة openclaw.json على ${sync.ref} — أعد تشغيل aichart-agent يدوياً.`,
        });
      } else if (sync && !sync.ok) {
        setMsg({
          type: "err",
          text:
            sync.error ??
            "حُفظت الإعدادات لكن فشلت مزامنة وكيل OpenClaw — شغّل sync-model.sh على السيرفر.",
        });
      } else {
        setMsg({ type: "ok", text: "تم حفظ المفاتيح في قاعدة البيانات." });
      }
    } finally {
      setSaving(false);
    }
  }

  const configuredCount = fields.filter((f) => f.configured).length;

  const AI_PROVIDERS = [
    { id: "anthropic", label: "Anthropic (Claude)", keyField: "ANTHROPIC_API_KEY" },
    { id: "openai", label: "OpenAI", keyField: "OPENAI_API_KEY" },
    { id: "google", label: "Google (Gemini)", keyField: "GEMINI_API_KEY" },
  ] as const;
  type ProviderId = (typeof AI_PROVIDERS)[number]["id"];

  const providerField = fields.find((f) => f.key === "AI_PROVIDER");
  const rawSaved = (providerField?.value || "anthropic").toLowerCase();
  const savedProvider = (
    rawSaved === "openrouter" || rawSaved === "gemini" ? "google" : rawSaved
  ) as ProviderId;
  const draftProvider = draft.AI_PROVIDER?.toLowerCase();
  const selectedProvider = (
    draftProvider === "openrouter" || draftProvider === "gemini"
      ? "google"
      : draftProvider || savedProvider
  ) as ProviderId;
  const providerMeta =
    AI_PROVIDERS.find((p) => p.id === selectedProvider) ?? AI_PROVIDERS[0];

  const apiKeyField = fields.find((f) => f.key === providerMeta.keyField);
  const aiModelField = fields.find((f) => f.key === "AI_MODEL");
  const legacyModelField = fields.find((f) => f.key === "ANTHROPIC_MODEL");
  const currentAiModel =
    aiModelField?.value ||
    (selectedProvider === "anthropic"
      ? legacyModelField?.value ?? "claude-3-5-sonnet-latest"
      : "");

  const claudeFields = fields.filter(
    (f) =>
      f.group === "claude" &&
      f.key !== "AI_PROVIDER" &&
      f.key !== "AI_MODEL" &&
      f.key !== "ANTHROPIC_MODEL" &&
      f.key !== "ANTHROPIC_API_KEY" &&
      f.key !== "OPENAI_API_KEY" &&
      f.key !== "GEMINI_API_KEY",
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
            ضع مفاتيح API والأسرار من لوحة الإدارة — تُخزَّن مشفّرة في قاعدة
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
          group.id === "claude"
            ? claudeFields
            : fields.filter((f) => f.group === group.id);
        if (!groupFields.length && group.id !== "claude") return null;
        if (group.id === "claude" && !apiKeyField) return null;
        return (
          <section key={group.id} className="admin-card p-4">
            <h3 className="mb-4 font-bold text-foreground">{group.title}</h3>
            <div className="space-y-4">
              {group.id === "claude" && apiKeyField && (
                <>
                  <div>
                    <p className="mb-1.5 text-sm font-medium">
                      المزود
                      <span
                        className="mr-2 text-[10px] text-muted-foreground"
                        dir="ltr"
                      >
                        AI_PROVIDER
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {AI_PROVIDERS.map((p) => {
                        const active = selectedProvider === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setDraftValue("AI_PROVIDER", p.id)}
                            className={cn(
                              "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                              active
                                ? "border-primary/50 bg-primary/10 text-primary"
                                : "border-white/10 text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <ConfigFieldRow
                    f={apiKeyField}
                    draft={draft}
                    setDraftValue={setDraftValue}
                  />
                  <ClaudeModelPicker
                    provider={selectedProvider}
                    providerLabel={providerMeta.label}
                    apiKeyDraft={draft[providerMeta.keyField] ?? ""}
                    apiKeyConfigured={apiKeyField.configured}
                    currentModel={currentAiModel}
                    draftModel={draft.AI_MODEL ?? ""}
                    onSelectModel={(id) => setDraftValue("AI_MODEL", id)}
                  />
                  {agentModel && (
                    <div className="space-y-2">
                      <p
                        className={cn(
                          "rounded-lg px-3 py-2 text-xs",
                          agentModel.inSync
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "bg-amber-500/10 text-amber-800 dark:text-amber-200",
                        )}
                      >
                        {agentModel.inSync ? (
                          <>
                            وكيل Telegram متزامن:{" "}
                            <code dir="ltr">{agentModel.gatewayPrimary}</code>
                          </>
                        ) : agentModel.gatewayConfigReadable ? (
                          <>
                            وكيل Telegram غير متزامن — المنصة:{" "}
                            <code dir="ltr">{agentModel.platformRef}</code>
                            {" · "}
                            Gateway:{" "}
                            <code dir="ltr">
                              {agentModel.gatewayPrimary ?? "غير مُعدّ"}
                            </code>
                            {!agentModel.providerRegistered &&
                              agentModel.gatewayPrimary && (
                                <>
                                  {" "}
                                  (النموذج غير مُسجّل في providers — احفظ من
                                  اللوحة)
                                </>
                              )}
                            . احفظ النموذج لمزامنة تلقائية.
                          </>
                        ) : (
                          <>
                            لم يُعثر على openclaw.json على السيرفر — المزامنة
                            التلقائية تعمل على VPS فقط.
                          </>
                        )}
                      </p>
                      {!agentModel.inSync && agentModel.gatewayConfigReadable && (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            void save({
                              AI_PROVIDER: selectedProvider,
                              AI_MODEL:
                                draft.AI_MODEL?.trim() || currentAiModel,
                            })
                          }
                          className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-100"
                        >
                          <RefreshCw
                            className={cn(
                              "h-3.5 w-3.5",
                              saving && "animate-spin",
                            )}
                          />
                          إعادة مزامنة الآن
                        </button>
                      )}
                    </div>
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
        تحذير: تغيير <span dir="ltr">ENCRYPTION_KEY</span> بعد ربط حسابات Binance
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
