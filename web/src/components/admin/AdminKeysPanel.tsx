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

type ProbeDiagnostic = {
  id: string;
  available: boolean;
  responsesApi: boolean;
  vision: boolean;
  structuredOutputs: boolean;
  supportedReasoningValues: string[];
  eligibleAsDefault: boolean;
  costTier: string;
  lastVerifiedAt: number | null;
  probeErrorCodes: string[];
};

const GROUPS: { id: ConfigField["group"]; title: string }[] = [
  { id: "core", title: "الأساس والأمان" },
  { id: "ai", title: "OpenAI — المفتاح ونماذج التداول" },
  { id: "telegram", title: "تليجرام" },
  { id: "ops", title: "التشغيل والمراقبة" },
];

export function AdminKeysPanel() {
  const [fields, setFields] = useState<ConfigField[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [diagnostics, setDiagnostics] = useState<ProbeDiagnostic[]>([]);

  const loadProbes = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/config/trading-models", {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setDiagnostics(data.diagnostics ?? []);
    } catch {
      setDiagnostics([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes] = await Promise.all([
        fetch("/api/admin/config"),
        loadProbes(),
      ]);
      const data = await configRes.json();
      if (configRes.ok) setFields(data.fields);
    } finally {
      setLoading(false);
    }
  }, [loadProbes]);

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
      setMsg({
        type: "ok",
        text: "تم حفظ المفاتيح. اختيار نموذج التحليل يتم من محادثة المستخدم.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function refreshTradingModels() {
    setProbing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/config/trading-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: draft.OPENAI_API_KEY?.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "فشل فحص النماذج." });
        return;
      }
      setDiagnostics(data.diagnostics ?? []);
      const available = (data.diagnostics ?? []).filter(
        (d: ProbeDiagnostic) => d.available,
      ).length;
      setMsg({
        type: "ok",
        text: `تم فحص النماذج — ${available} نموذج جاهز للتداول. المستخدم يختار من المحادثة.`,
      });
    } finally {
      setProbing(false);
    }
  }

  const configuredCount = fields.filter((f) => f.configured).length;

  const apiKeyField = fields.find((f) => f.key === "OPENAI_API_KEY");
  const realtimeModelField = fields.find(
    (f) => f.key === "OPENAI_REALTIME_MODEL",
  );
  const currentRealtimeModel = realtimeModelField?.value ?? "gpt-realtime";

  const aiExtraFields = fields.filter(
    (f) =>
      f.group === "ai" &&
      f.key !== "OPENAI_API_KEY" &&
      f.key !== "AI_MODEL" &&
      f.key !== "OPENAI_REALTIME_MODEL",
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
            ضع مفتاح OpenAI هنا — اختيار نموذج تحليل التداول يتم من محادثة
            المستخدم بعد فحص القدرات. القيم من <code dir="ltr">.env</code> تبقى
            احتياطاً.
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
                  <ConfigFieldRow
                    f={apiKeyField}
                    draft={draft}
                    setDraftValue={setDraftValue}
                  />
                  <div className="rounded-lg border border-white/10 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          نماذج تحليل التداول (مُتحقَّقة)
                        </p>
                        <p className="text-xs text-muted-foreground">
                          فحص Responses + Vision + Structured Outputs. لا تُخزَّن
                          أخطاء المزوّد الخام. الاختيار النهائي للمستخدم في
                          المحادثة.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void refreshTradingModels()}
                        disabled={probing || !apiKeyField.configured}
                        className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:text-foreground disabled:opacity-50"
                      >
                        <RefreshCw
                          className={cn(
                            "h-3.5 w-3.5",
                            probing && "animate-spin",
                          )}
                        />
                        {probing ? "جارٍ الفحص…" : "تحديث الفحص"}
                      </button>
                    </div>
                    {diagnostics.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        لم يُجرَ فحص بعد — احفظ المفتاح ثم اضغط «تحديث الفحص».
                      </p>
                    ) : (
                      <ul className="space-y-1.5 text-xs" dir="ltr">
                        {diagnostics.map((d) => (
                          <li
                            key={d.id}
                            className="flex flex-wrap items-center gap-2 rounded bg-secondary/60 px-2 py-1"
                          >
                            <code>{d.id}</code>
                            <span
                              className={
                                d.available
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-muted-foreground"
                              }
                            >
                              {d.available ? "available" : "unavailable"}
                            </span>
                            {d.supportedReasoningValues.length > 0 && (
                              <span className="text-muted-foreground">
                                reasoning:{" "}
                                {d.supportedReasoningValues.join("/")}
                              </span>
                            )}
                            {d.eligibleAsDefault && (
                              <span className="text-primary">default-eligible</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
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
