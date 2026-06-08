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
  { id: "claude", title: "Claude / Anthropic" },
  { id: "telegram", title: "تليجرام" },
  { id: "ops", title: "التشغيل والمراقبة" },
];

export function AdminKeysPanel() {
  const [fields, setFields] = useState<ConfigField[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/config");
      const data = await res.json();
      if (res.ok) setFields(data.fields);
    } finally {
      setLoading(false);
    }
  }, []);

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
      setMsg({ type: "ok", text: "تم حفظ المفاتيح في قاعدة البيانات." });
    } finally {
      setSaving(false);
    }
  }

  async function registerWebhook() {
    setWebhookBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/config", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "err", text: data.error ?? "فشل تسجيل Webhook." });
        return;
      }
      setMsg({
        type: "ok",
        text: `تم تسجيل Webhook: ${data.webhookUrl}`,
      });
    } finally {
      setWebhookBusy(false);
    }
  }

  const configuredCount = fields.filter((f) => f.configured).length;
  const apiKeyField = fields.find((f) => f.key === "ANTHROPIC_API_KEY");
  const modelField = fields.find((f) => f.key === "ANTHROPIC_MODEL");
  const claudeFields = fields.filter(
    (f) =>
      f.group === "claude" &&
      f.key !== "ANTHROPIC_MODEL" &&
      f.key !== "ANTHROPIC_API_KEY",
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
                  <ConfigFieldRow
                    f={apiKeyField}
                    draft={draft}
                    setDraftValue={setDraftValue}
                  />
                  <ClaudeModelPicker
                    apiKeyDraft={draft.ANTHROPIC_API_KEY ?? ""}
                    apiKeyConfigured={apiKeyField.configured}
                    currentModel={
                      modelField?.value ??
                      modelField?.placeholder ??
                      "claude-3-5-sonnet-latest"
                    }
                    draftModel={draft.ANTHROPIC_MODEL ?? ""}
                    onSelectModel={(id) => setDraftValue("ANTHROPIC_MODEL", id)}
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
        <button
          type="button"
          onClick={() => void registerWebhook()}
          disabled={webhookBusy}
          className="rounded-lg border border-white/10 px-5 py-2.5 text-sm text-muted-foreground hover:text-foreground"
        >
          {webhookBusy ? "…" : "تسجيل Webhook تليجرام"}
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
