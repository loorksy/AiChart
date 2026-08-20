"use client";

import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { ProviderIcon } from "@/components/agent/ProviderIcon";
import { shortModelLabel } from "@/lib/modelCatalog";

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
 * The user's own model choice.
 *
 * The operator supplies API keys; which brain answers is the user's call, so
 * the control lives with the message box rather than in an admin panel — now
 * one section of the composer's options menu, since a permanently visible
 * model chip was one control too many on a phone-width row.
 *
 * Loads on demand: `enabled` is the menu's open state, so a console that never
 * opens the menu never asks for the catalogue.
 */
export function useAgentModels(enabled: boolean) {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/agent/models", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as ModelsResponse;
        if (alive) setData(json);
      } catch {
        /* the section simply stays hidden */
      }
    };
    void load();
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled]);

  const choose = useCallback(async (ref: string | null) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferred_model_ref: ref }),
      });
      if (res.ok) setData((prev) => (prev ? { ...prev, selected: ref } : prev));
      return res.ok;
    } finally {
      setSaving(false);
    }
  }, []);

  const activeRef = data ? (data.selected ?? data.platformDefault) : null;
  const rawActiveLabel = data
    ? (data.models.find((m) => m.ref === activeRef)?.label ??
      activeRef?.split("/").pop() ??
      activeRef)
    : null;
  const activeLabel = rawActiveLabel ? shortModelLabel(rawActiveLabel) : null;

  return {
    data,
    saving,
    choose,
    activeLabel,
    /** Nothing to offer when no provider key is configured. */
    available: Boolean(data?.configured) && (data?.models.length ?? 0) > 0,
  };
}

const ROW_CLASS = "composer-sheet-item";

/** The model list itself, rendered inside whatever surface hosts it. */
export function ModelChoiceList({
  models,
  selected,
  platformDefault,
  saving,
  onChoose,
}: {
  models: ModelOption[];
  selected: string | null;
  /** Ref that serves when the user made no explicit pick — shown by its real name. */
  platformDefault: string;
  saving: boolean;
  onChoose: (ref: string | null) => void;
}) {
  // No abstract "platform default" row: the default model appears in the list
  // under its own name, pre-checked, and the user just picks another to change.
  const effective = selected ?? platformDefault;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? models.filter(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          m.model.toLowerCase().includes(q) ||
          m.ref.toLowerCase().includes(q),
      )
    : models;
  const grouped = filtered.reduce<Record<string, ModelOption[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div>
      {models.length > 24 && (
        <div className="px-2.5 pb-1.5 pt-1">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن نموذج…"
            dir="rtl"
            className="focus-ring tap-target h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
            aria-label="بحث النماذج"
          />
        </div>
      )}
      {Object.entries(grouped).map(([provider, options]) => (
        <div key={provider}>
          <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ProviderIcon provider={provider} model={options[0]?.model} size={12} />
            {PROVIDER_LABEL[provider] ?? provider}
          </p>
          {options.map((m) => (
            <button
              key={m.ref}
              type="button"
              disabled={saving}
              onClick={() => onChoose(m.ref)}
              data-active={effective === m.ref}
              className={ROW_CLASS}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <ProviderIcon
                  provider={provider}
                  model={m.model}
                  size={13}
                  className="text-muted-foreground"
                />
                <span className="truncate" dir="ltr">
                  {shortModelLabel(m.label)}
                </span>
              </span>
              {effective === m.ref && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            </button>
          ))}
        </div>
      ))}
      {q && filtered.length === 0 && (
        <p className="px-2.5 py-2 text-xs text-muted-foreground">لا نتائج.</p>
      )}
    </div>
  );
}
