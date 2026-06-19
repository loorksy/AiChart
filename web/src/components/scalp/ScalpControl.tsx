"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";

interface ScalpSettings {
  scalp_enabled: number;
  scalp_execution_mode: "paper" | "live";
}

interface ScalpSession {
  active: number;
  symbol: string;
  market: string;
  interval: string;
  max_trades: number;
  executed_count: number;
}

interface ScalpStatus {
  session: ScalpSession | null;
  scalp_enabled: number;
  scalp_execution_mode: "paper" | "live";
}

/**
 * User dashboard card — controls the agent's *permission* to use scalp mode.
 * The agent starts/stops the actual session during conversation (not here).
 */
export function ScalpControl() {
  const [status, setStatus] = useState<ScalpStatus | null>(null);
  const [settings, setSettings] = useState<ScalpSettings>({
    scalp_enabled: 0,
    scalp_execution_mode: "paper",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );

  async function refresh() {
    try {
      const r = await fetch("/api/scalp", { cache: "no-store" });
      if (r.ok) {
        const d: ScalpStatus = await r.json();
        setStatus(d);
        setSettings({
          scalp_enabled: d.scalp_enabled,
          scalp_execution_mode: d.scalp_execution_mode,
        });
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => { void refresh(); }, []);

  // Poll while agent has an active session to keep executed_count fresh.
  useEffect(() => {
    if (!status?.session?.active) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [status?.session?.active]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/scalp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settings",
          scalp_enabled: settings.scalp_enabled,
          scalp_execution_mode: settings.scalp_execution_mode,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ type: "err", text: d.error ?? "تعذّر الحفظ." });
      } else {
        setMsg({ type: "ok", text: "تم الحفظ." });
        await refresh();
      }
    } catch {
      setMsg({ type: "err", text: "خطأ في الاتصال." });
    } finally {
      setBusy(false);
    }
  }

  const enabled = Boolean(settings.scalp_enabled);
  const session = status?.session;
  const agentRunning = Boolean(session?.active);

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Activity className="h-4 w-4" />
          وضع السكالب
        </h2>
        {agentRunning && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-500">
            الوكيل يعمل
          </span>
        )}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        عند التفعيل يمكن للوكيل استخدام وضع السكالب أثناء المحادثة. هو من يسألك عن الرمز المستهدف.
      </p>

      <div className="mt-4 space-y-4">
        {/* Enable / disable toggle */}
        <label className="flex cursor-pointer items-center justify-between">
          <span className="text-sm font-medium">
            {enabled ? "السكالب مفعّل — الوكيل مسموح له باستخدامه" : "السكالب معطّل"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() =>
              setSettings((s) => ({ ...s, scalp_enabled: enabled ? 0 : 1 }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </label>

        {/* Execution mode dropdown */}
        <label className="block text-sm">
          <span className="font-medium">وضع التنفيذ</span>
          <select
            value={settings.scalp_execution_mode}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                scalp_execution_mode: e.target.value as "paper" | "live",
              }))
            }
            className="input mt-1 w-full"
          >
            <option value="paper">تجريبي (paper) — يسجّل القرارات بلا صفقات حقيقية</option>
            <option value="live">حقيقي (live) — ينفّذ صفقات فعلية</option>
          </select>
          {settings.scalp_execution_mode === "live" && (
            <p className="mt-1 text-xs text-amber-500">
              ⚠️ الوضع الحقيقي ينفّذ صفقات بأموال فعلية — تأكّد من الإعدادات.
            </p>
          )}
        </label>

        <button
          onClick={() => void save()}
          disabled={busy}
          className="btn btn-primary text-sm"
        >
          {busy ? "جاري الحفظ…" : "حفظ"}
        </button>
      </div>

      {/* Agent session status (read-only — agent manages this) */}
      {agentRunning && session && (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground">جلسة الوكيل الحالية</p>
          <p className="mt-1 text-sm">
            <span className="font-semibold">{session.symbol}</span> ·{" "}
            {session.interval} · {session.market}
          </p>
          <p className="text-sm text-muted-foreground">
            صفقات منفّذة: {session.executed_count} / {session.max_trades}
          </p>
        </div>
      )}

      {msg && (
        <p
          className={`mt-3 text-sm ${
            msg.type === "ok" ? "text-emerald-500" : "text-red-500"
          }`}
        >
          {msg.text}
        </p>
      )}
    </SurfaceCard>
  );
}
