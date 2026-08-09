"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, KeyRound, RefreshCw } from "lucide-react";

import { OpenAIModelPicker } from "@/components/admin/OpenAIModelPicker";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import {
  CardSkeleton,
  PageHeaderSkeleton,
} from "@/components/ui/skeletons/page-skeletons";
import { cn } from "@/lib/utils";
import {
  AdminPage,
  CollapsibleCard,
  Field,
  InlineAlert,
  SectionHeader,
  Spinner,
  StickySaveBar,
} from "@/components/admin/ui/AdminKit";

type ConfigField = {
  key: string;
  label: string;
  labelEn: string;
  group: "core" | "ai" | "markets" | "telegram" | "ops";
  type?: "text" | "url" | "toggle";
  placeholder?: string;
  configured: boolean;
  source: "db" | "env" | null;
  masked?: string;
  value?: string;
  secret?: boolean;
};

const GROUPS: { id: ConfigField["group"]; title: string; description: string }[] = [
  {
    id: "core",
    title: "الأساس والأمان",
    description: "مفاتيح التشفير والوصول التي تقوم عليها بقية المنصة.",
  },
  {
    id: "ai",
    title: "الذكاء الاصطناعي — المفاتيح والافتراضي",
    description: "المزوّد والنموذج اللذان يعملان لمن لم يختر بنفسه.",
  },
  {
    id: "markets",
    title: "بيانات السوق والوسطاء",
    description: "مفاتيح الأنابيب التي تصل الأسعار والحسابات — OANDA و MetaApi.",
  },
  { id: "telegram", title: "تليجرام", description: "البوت وقنوات الإشعار." },
  {
    id: "ops",
    title: "التشغيل والمراقبة",
    description: "المهام المجدولة، السجلات، وقنوات الإنذار.",
  },
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
  { id: "openrouter", label: "OpenRouter (اختبار)" },
];

/** Curated OpenRouter route ids offered for testing (id → label). */
const OPENROUTER_MODELS: { id: string; label: string }[] = [
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash" },
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
      setMsg({
        type: "err",
        text: "لا يوجد ما يُحفظ — اكتب قيمة جديدة في حقل واحد على الأقل ثم اضغط حفظ.",
      });
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
        setMsg({
          type: "err",
          text: data.error ?? "فشل الحفظ — القيم القديمة ما زالت سارية. أعد المحاولة.",
        });
        return;
      }
      setFields(data.fields);
      setDraft({});
      await loadAgentModelStatus();
      setMsg({
        type: "ok",
        text: "تم حفظ المفاتيح — المنصة و MCP يستخدمان المزوّد والنموذج المحدّدين هنا.",
      });
    } catch {
      setMsg({
        type: "err",
        text: "تعذّر الوصول إلى الخادم — لم يُحفظ أي مفتاح.",
      });
    } finally {
      setSaving(false);
    }
  }

  const configuredCount = fields.filter((f) => f.configured).length;
  const pendingCount = Object.values(draft).filter((v) => v.trim()).length;

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
  const openrouterEnabledField = fields.find((f) => f.key === "OPENROUTER_ENABLED");
  const openrouterKeyField = fields.find((f) => f.key === "OPENROUTER_API_KEY");
  const openrouterModelField = fields.find((f) => f.key === "OPENROUTER_MODEL");
  const providerRaw = draft.AI_PROVIDER ?? providerField?.value ?? "openai";
  const activeProvider =
    providerRaw === "anthropic" || providerRaw === "openrouter"
      ? providerRaw
      : "openai";
  const currentAnthropicModel =
    draft.ANTHROPIC_MODEL ?? anthropicModelField?.value ?? "claude-opus-5";
  const currentOpenRouterModel =
    draft.OPENROUTER_MODEL ??
    openrouterModelField?.value ??
    "openai/gpt-4o-mini";

  const aiExtraFields = fields.filter(
    (f) =>
      f.group === "ai" &&
      f.key !== "OPENAI_API_KEY" &&
      f.key !== "AI_MODEL" &&
      f.key !== "OPENAI_REALTIME_MODEL" &&
      f.key !== "AI_PROVIDER" &&
      f.key !== "ANTHROPIC_API_KEY" &&
      f.key !== "ANTHROPIC_MODEL" &&
      f.key !== "OPENROUTER_ENABLED" &&
      f.key !== "OPENROUTER_API_KEY" &&
      f.key !== "OPENROUTER_MODEL",
  );

  if (loading && fields.length === 0) {
    return (
      <AdminPage width="narrow" dir="rtl">
        <PageHeaderSkeleton withAction />
        <CardSkeleton lines={4} />
        <CardSkeleton lines={6} />
      </AdminPage>
    );
  }

  return (
    <AdminPage width="narrow" dir="rtl" data-testid="admin-keys-panel">
      <SectionHeader
        title="المفاتيح والإعدادات"
        icon={KeyRound}
        description={
          <>
            ضع مفتاح المزوّد والنموذج من لوحة الإدارة — تُخزَّن مشفّرة في قاعدة
            البيانات. القيم من <code dir="ltr">.env</code> تبقى احتياطاً.
          </>
        }
        actions={
          <div className="flex items-center gap-3">
            <span className="type-numeric text-sm text-muted-foreground" dir="ltr">
              <span className="font-semibold text-foreground">
                {configuredCount}/{fields.length}
              </span>{" "}
              <span dir="rtl">مفتاح مُعدّ</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              className="tap-target"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? <Spinner /> : <RefreshCw className="size-3.5" aria-hidden />}
              تحديث
            </Button>
          </div>
        }
      />

      {GROUPS.map((group) => {
        const groupFields =
          group.id === "ai"
            ? aiExtraFields
            : fields.filter((f) => f.group === group.id);
        if (!groupFields.length && group.id !== "ai") return null;
        if (group.id === "ai" && !apiKeyField) return null;
        const groupConfigured = groupFields.filter((f) => f.configured).length;
        return (
          <CollapsibleCard
            key={group.id}
            title={group.title}
            description={group.description}
            summary={
              groupFields.length ? (
                <span
                  className={cn(
                    "type-numeric rounded-full px-2 py-0.5 text-[11px] font-medium",
                    groupConfigured === groupFields.length
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-secondary text-muted-foreground",
                  )}
                  dir="ltr"
                >
                  {groupConfigured}/{groupFields.length}
                </span>
              ) : null
            }
          >
            <div className="space-y-5">
              {group.id === "ai" && apiKeyField && (
                <>
                  <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    دورك هنا إتاحة المفاتيح فقط — كل مستخدم يختار النموذج الذي
                    يريده من صندوق الكتابة في المحادثة. ما تضبطه أدناه هو
                    <b> الافتراضي </b>
                    لمن لم يختر.
                  </p>

                  {/* Default provider — the fallback brain for users who have
                      not picked one themselves. */}
                  <fieldset className="min-w-0 space-y-1.5">
                    <legend className="text-sm font-medium text-foreground">
                      المزوّد الافتراضي
                      <span className="ms-2 text-[10px] text-muted-foreground" dir="ltr">
                        AI_PROVIDER
                      </span>
                    </legend>
                    <div
                      role="radiogroup"
                      aria-label="المزوّد الافتراضي"
                      className="inline-flex gap-1 rounded-lg border border-border bg-background p-1"
                    >
                      {PROVIDERS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          role="radio"
                          aria-checked={activeProvider === p.id}
                          onClick={() => setDraftValue("AI_PROVIDER", p.id)}
                          className={cn(
                            "focus-ring tap-target rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-out",
                            activeProvider === p.id
                              ? "bg-foreground text-background"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>

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
                    <Field
                      label={
                        <>
                          نموذج Claude
                          <span className="ms-2 text-[10px] text-muted-foreground" dir="ltr">
                            ANTHROPIC_MODEL
                          </span>
                        </>
                      }
                      htmlFor="ANTHROPIC_MODEL"
                    >
                      <select
                        id="ANTHROPIC_MODEL"
                        dir="ltr"
                        className="admin-input focus-ring tap-target h-10 w-full text-sm"
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
                    </Field>
                  )}

                  <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-3">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">OpenRouter</span>
                      {" — "}
                      بوابة اختبار عبر{" "}
                      <a
                        href="https://openrouter.ai/"
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2"
                        dir="ltr"
                      >
                        openrouter.ai
                      </a>
                      . المفتاح وحده لا يكفي — يجب تفعيل المفتاح أدناه، ويمكن
                      إلغاء التفعيل في أي وقت دون حذف المفتاح.
                    </p>
                    {openrouterEnabledField && (
                      <ConfigFieldRow
                        f={openrouterEnabledField}
                        draft={draft}
                        setDraftValue={setDraftValue}
                      />
                    )}
                    {openrouterKeyField && (
                      <ConfigFieldRow
                        f={openrouterKeyField}
                        draft={draft}
                        setDraftValue={setDraftValue}
                      />
                    )}
                    {openrouterModelField && (
                      <Field
                        label={
                          <>
                            نموذج OpenRouter
                            <span
                              className="ms-2 text-[10px] text-muted-foreground"
                              dir="ltr"
                            >
                              OPENROUTER_MODEL
                            </span>
                          </>
                        }
                        htmlFor="OPENROUTER_MODEL"
                      >
                        <select
                          id="OPENROUTER_MODEL"
                          dir="ltr"
                          className="admin-input focus-ring tap-target h-10 w-full text-sm"
                          value={currentOpenRouterModel}
                          onChange={(e) =>
                            setDraftValue("OPENROUTER_MODEL", e.target.value)
                          }
                        >
                          {OPENROUTER_MODELS.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label} — {m.id}
                            </option>
                          ))}
                          {!OPENROUTER_MODELS.some(
                            (m) => m.id === currentOpenRouterModel,
                          ) && (
                            <option value={currentOpenRouterModel}>
                              {currentOpenRouterModel}
                            </option>
                          )}
                        </select>
                      </Field>
                    )}
                  </div>

                  {agentModel && (
                    <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      نموذج المنصة (MCP):{" "}
                      <code dir="ltr">{agentModel.platformRef}</code>
                      {agentModel.fallbacks.length > 0 && (
                        <>
                          {" · "}
                          fallbacks:{" "}
                          <code dir="ltr">{agentModel.fallbacks.join(", ")}</code>
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
          </CollapsibleCard>
        );
      })}

      {msg && (
        <InlineAlert tone={msg.type === "ok" ? "ok" : "error"}>{msg.text}</InlineAlert>
      )}

      <StickySaveBar
        visible={pendingCount > 0}
        saving={saving}
        pendingCount={pendingCount}
        onSave={() => void save()}
        savingLabel="جارٍ الحفظ…"
        saveLabel="حفظ المفاتيح"
        pendingLabel={(n) => `${n} تعديل غير محفوظ`}
      >
        تحذير: تغيير <span dir="ltr">ENCRYPTION_KEY</span> بعد ربط حسابات
        MetaTrader يمنع فك تشفير المفاتيح القديمة.
      </StickySaveBar>
    </AdminPage>
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
  if (f.type === "toggle") {
    // Draft wins so unchecking an already-on toggle can persist as "0".
    const on = (draft[f.key] ?? f.value ?? "0") === "1";
    return (
      <Field
        label={
          <>
            {f.label}
            <span className="ms-2 text-[10px] text-muted-foreground" dir="ltr">
              {f.labelEn}
            </span>
          </>
        }
        htmlFor={f.key}
        suffix={<StatusBadge field={f} />}
      >
        {/* The Field above already labels this control, so the word beside the
            box is a plain span — a second <label> would name it twice. */}
        <span className="tap-target flex items-center gap-2 text-sm text-muted-foreground">
          <input
            id={f.key}
            type="checkbox"
            checked={on}
            onChange={(e) => setDraftValue(f.key, e.target.checked ? "1" : "0")}
            className="focus-ring size-4 accent-[var(--primary)]"
          />
          مفعّل
        </span>
      </Field>
    );
  }

  const current = f.configured && f.masked ? `الحالي: ${f.masked}` : !f.configured && f.value ? f.value : undefined;

  return (
    <Field
      label={
        <>
          {f.label}
          <span className="ms-2 text-[10px] text-muted-foreground" dir="ltr">
            {f.labelEn}
          </span>
        </>
      }
      htmlFor={f.key}
      hint={
        current ? (
          <span dir="ltr" className="block text-start">
            {current}
          </span>
        ) : undefined
      }
      suffix={<StatusBadge field={f} />}
    >
      <Input
        id={f.key}
        type={f.type === "url" ? "url" : f.secret ? "password" : "text"}
        className="tap-target h-10 text-sm"
        dir="ltr"
        placeholder={draft[f.key] ? undefined : (f.placeholder ?? "أدخل قيمة جديدة…")}
        value={draft[f.key] ?? ""}
        onChange={(e) => setDraftValue(f.key, e.target.value)}
        aria-describedby={current ? `${f.key}-hint` : undefined}
        autoComplete="off"
      />
    </Field>
  );
}

function StatusBadge({ field }: { field: ConfigField }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium",
        field.configured
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {field.configured ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : (
        <Circle className="size-3" aria-hidden />
      )}
      {field.configured ? (field.source === "db" ? "محفوظ" : ".env") : "غير مُعدّ"}
    </span>
  );
}
