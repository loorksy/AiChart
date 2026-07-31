"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

interface UserSkill {
  name: string;
  description: string;
  version: string;
  riskLevel: string;
  tags: string[];
  enabled: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

const TEMPLATE = `---
name: my-strategy
version: 1.0.0
description: قواعد استراتيجيتي الخاصة في السكالبينج
category: analysis
riskLevel: analysis
supportedLocales: ["ar","en"]
tags: ["scalping","strategy"]
---

# استراتيجيتي

- ادخل فقط مع اتجاه فريم الساعة.
- تجاهل الإشارات أثناء الأخبار عالية التأثير.
`;

/** Upload, list, toggle, and delete the user's own agent skills. */
export function UserSkillsPanel() {
  const { t } = useLocale();
  const [skills, setSkills] = useState<UserSkill[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/skills", { cache: "no-store" });
    const json = res.ok ? ((await res.json()) as { skills?: UserSkill[] }) : null;
    setSkills(json?.skills ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(content: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const json = (await res.json()) as { error?: string; skill?: UserSkill };
      if (!res.ok) {
        setMessage({ ok: false, text: json.error ?? t("skills.save_failed") });
        return;
      }
      setMessage({ ok: true, text: t("skills.saved") });
      setDraft("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(name: string, enabled: boolean) {
    await fetch(`/api/skills/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    await load();
  }

  async function remove(name: string) {
    if (!window.confirm(t("skills.delete_confirm"))) return;
    await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
    await load();
  }

  function onFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      if (text.trim()) void submit(text);
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-4">
      <SurfaceCard className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{t("skills.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("skills.description")}</p>
        </div>

        {skills === null ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : skills.length === 0 ? (
          <p className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
            {t("skills.empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {skills.map((skill) => (
              <li
                key={skill.name}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold" dir="ltr">
                    {skill.name}@{skill.version}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {skill.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-foreground"
                      checked={skill.enabled}
                      onChange={(e) => void toggle(skill.name, e.target.checked)}
                    />
                    {t("skills.enabled")}
                  </label>
                  <button
                    type="button"
                    onClick={() => void remove(skill.name)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t("skills.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SurfaceCard>

      <SurfaceCard className="space-y-3">
        <h3 className="text-sm font-semibold">{t("skills.add_title")}</h3>
        <textarea
          dir="ltr"
          rows={10}
          className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs"
          placeholder={TEMPLATE}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void submit(draft)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50"
          >
            {t("skills.save")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {t("skills.upload")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".md,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => onFile(e.target.files)}
          />
          <button
            type="button"
            onClick={() => setDraft(TEMPLATE)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {t("skills.use_template")}
          </button>
        </div>
        {message && (
          <p
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              message.ok
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {message.text}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t("skills.safety_note")}</p>
      </SurfaceCard>
    </div>
  );
}
