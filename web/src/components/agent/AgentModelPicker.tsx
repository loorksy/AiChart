"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { cn } from "@/lib/utils";

interface ModelOption {
  ref: string;
  provider: "openai" | "anthropic";
  model: string;
  label: string;
}

interface ModelsResponse {
  models: ModelOption[];
  selected: string | null;
  platformDefault: string;
  configured: boolean;
}

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/**
 * The user's own model choice, in the composer where they type.
 *
 * The operator supplies API keys; which brain answers is the user's call, so
 * the control lives next to the message box rather than in an admin panel.
 * Renders nothing when no provider key is configured — an empty picker would
 * only offer a choice that cannot work.
 */
export function AgentModelPicker() {
  const { t, dir } = useLocale();
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/agent/models", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as ModelsResponse;
        if (alive) setData(json);
      } catch {
        /* picker simply stays hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Close on outside click / Escape — a dropdown pinned over the chat must not
  // swallow the next thing the user does.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = useCallback(async (ref: string | null) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferred_model_ref: ref }),
      });
      if (res.ok) {
        setData((prev) => (prev ? { ...prev, selected: ref } : prev));
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }, []);

  if (!data?.configured || data.models.length === 0) return null;

  const activeRef = data.selected ?? data.platformDefault;
  const active = data.models.find((m) => m.ref === activeRef);
  const activeLabel = active?.label ?? activeRef.split("/").pop() ?? activeRef;

  const grouped = data.models.reduce<Record<string, ModelOption[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div ref={boxRef} className="relative mb-0.5 shrink-0" dir={dir}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("model.picker_title")}
        aria-label={t("model.picker_title")}
        aria-expanded={open}
        className="flex min-h-8 max-w-[9rem] items-center gap-1 rounded-full px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Cpu className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate" dir="ltr">
          {activeLabel}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
      </button>

      {open && (
        <div className="absolute bottom-full z-40 mb-2 max-h-72 w-64 overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-lg end-0">
          <button
            type="button"
            disabled={saving}
            onClick={() => void choose(null)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-xs hover:bg-muted",
              !data.selected && "font-semibold",
            )}
          >
            <span>{t("model.platform_default")}</span>
            {!data.selected && <Check className="h-3.5 w-3.5 shrink-0" />}
          </button>
          {Object.entries(grouped).map(([provider, models]) => (
            <div key={provider}>
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {PROVIDER_LABEL[provider] ?? provider}
              </p>
              {models.map((m) => (
                <button
                  key={m.ref}
                  type="button"
                  disabled={saving}
                  onClick={() => void choose(m.ref)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-start text-xs hover:bg-muted",
                    data.selected === m.ref && "font-semibold",
                  )}
                >
                  <span className="truncate" dir="ltr">
                    {m.label}
                  </span>
                  {data.selected === m.ref && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
