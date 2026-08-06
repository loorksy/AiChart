"use client";

/**
 * "What the agent remembers about you" (Phase 4 memory transparency).
 * Lists every active memory — extracted preferences, trade lessons, scenario
 * profiles — with per-row deletion. A remembered fact the user cannot see and
 * revoke is not a feature, it is a liability.
 */
import { useCallback, useEffect, useState } from "react";
import { Brain, Trash2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

/** Sources with a translated label; anything else renders its raw name. */
const KNOWN_SOURCES = new Set(["scenario_assembler", "agent", "daily_summary"]);

interface MemoryItem {
  id: number;
  category: string;
  memoryType: string;
  content: string;
  symbol: string | null;
  source: string;
  createdAt: string | number;
}

export function AgentMemoryPanel() {
  const { t, dir, locale } = useLocale();
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/memory", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { memories?: MemoryItem[] };
      setItems(data.memories ?? []);
      setError(false);
    } catch {
      setError(true);
      setItems((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (id: number) => {
      setBusyId(id);
      try {
        const res = await fetch("/api/agent/memory", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (res.ok) setItems((prev) => (prev ?? []).filter((m) => m.id !== id));
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  return (
    <section dir={dir} data-testid="agent-memory-panel" className="space-y-2">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Brain className="h-4 w-4" aria-hidden />
          {t("settings.memory.title")}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.memory.description")}
        </p>
      </div>

      {error ? (
        <p className="rounded-[var(--radius)] bg-destructive/10 p-3 text-xs text-destructive-foreground">
          {t("settings.memory.error")}
        </p>
      ) : null}

      {items == null ? null : items.length === 0 ? (
        <p className="rounded-[var(--radius)] bg-muted/50 p-3 text-xs text-muted-foreground">
          {t("settings.memory.empty")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2 rounded-[var(--radius)] bg-muted/50 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap text-xs leading-5 text-foreground">
                  {item.content}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                  {item.symbol ? <span className="font-mono">{item.symbol}</span> : null}
                  <span>
                    {KNOWN_SOURCES.has(item.source)
                      ? t(`settings.memory.source.${item.source}`)
                      : item.source}
                  </span>
                  <span>
                    {new Date(item.createdAt).toLocaleDateString(
                      locale === "ar" ? "ar" : "en",
                    )}
                  </span>
                </p>
              </div>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => void remove(item.id)}
                aria-label={t("settings.memory.forget")}
                title={t("settings.memory.forget")}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
