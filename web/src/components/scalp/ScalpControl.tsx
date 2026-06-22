"use client";

import { useEffect, useState } from "react";
import { Activity, Play, Pause, Square, RotateCw } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";

type ScalpStatus = "active" | "paused" | "stopped";

interface ScalpSession {
  status: ScalpStatus;
  symbol: string;
  market: string;
  interval: string;
  max_trades: number;
  executed_count: number;
  execution_mode: "paper" | "live";
  session_pnl: number;
  stop_reason: string | null;
}

interface ScalpStatusResp {
  session: ScalpSession | null;
  scalp_enabled: number;
  scalp_execution_mode: "paper" | "live";
}

/**
 * User dashboard — controls the autonomous scalp session:
 * permission (enable + paper/live) and lifecycle (start/pause/resume/stop).
 */
export function ScalpControl() {
  const [status, setStatus] = useState<ScalpStatusResp | null>(null);
  const [settings, setSettings] = useState({
    scalp_enabled: 0,
    scalp_execution_mode: "paper" as "paper" | "live",
  });
  const [maxTrades, setMaxTrades] = useState(5);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );

  async function refresh() {
    try {
      const r = await fetch("/api/scalp", { cache: "no-store" });
      if (r.ok) {
        const d: ScalpStatusResp = await r.json();
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

  const session = status?.session ?? null;
  const sessionStatus: ScalpStatus = session?.status ?? "stopped";

  // Poll while a session is active/paused to keep counts + PnL fresh.
  useEffect(() => {
    if (sessionStatus === "stopped") return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [sessionStatus]);

  async function saveSettings() {
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
      setMsg(
        r.ok
          ? { type: "ok", text: "تم الحفظ." }
          : { type: "err", text: d.error ?? "تعذّر الحفظ." },
      );
      await refresh();
    } catch {
      setMsg({ type: "err", text: "خطأ في الاتصال." });
    } finally {
      setBusy(false);
    }
  }

  async function sessionAction(
    action: "start" | "pause" | "resume" | "stop",
  ) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/scalp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "start" ? { action, max_trades: maxTrades } : { action },
        ),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ type: "err", text: d.error ?? "تعذّر تنفيذ الإجراء." });
      } else {
        await refresh();
      }
    } catch {
      setMsg({ type: "err", text: "خطأ في الاتصال." });
    } finally {
      setBusy(false);
    }
  }

  const enabled = Boolean(settings.scalp_enabled);
  const statusLabel =
    sessionStatus === "active"
      ? "نشطة"
      : sessionStatus === "paused"
        ? "موقوفة مؤقتاً"
        : "متوقفة";
  const statusColor =
    sessionStatus === "active"
      ? "bg-emerald-500/15 text-emerald-500"
      : sessionStatus === "paused"
        ? "bg-amber-500/15 text-amber-500"
        : "bg-muted text-muted-foreground";

  return (
    <SurfaceCard>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Activity className="h-4 w-4" />
          جلسة السكالب الذاتية
        </h2>
        <span className={`rounded-full px-2 py-0.5 text-xs ${statusColor}`}>
          {statusLabel}
        </span>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        عند التشغيل يبحث الوكيل تلقائياً عن الفرص وينفّذ ضمن حدود إدارة المخاطر —
        دون موافقة لكل صفقة. يتوقّف تلقائياً عند بلوغ الحدود أو انقطاع الوسيط.
      </p>

      {/* Permission settings */}
      <div className="mt-4 space-y-3 border-b border-border pb-4">
        <label className="flex cursor-pointer items-center justify-between">
          <span className="text-sm font-medium">
            {enabled ? "السكالب مسموح" : "السكالب معطّل"}
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
            <option value="paper">تجريبي (paper) — قرارات بلا صفقات حقيقية</option>
            <option value="live">حقيقي (live) — ينفّذ صفقات فعلية</option>
          </select>
        </label>

        <button
          onClick={() => void saveSettings()}
          disabled={busy}
          className="btn btn-primary text-sm"
        >
          {busy ? "…" : "حفظ الإعدادات"}
        </button>
      </div>

      {/* Session lifecycle controls */}
      <div className="mt-4 space-y-3">
        {sessionStatus === "stopped" && (
          <>
            <label className="block text-sm">
              <span className="font-medium">سقف صفقات الجلسة</span>
              <input
                type="number"
                min={1}
                max={100}
                value={maxTrades}
                onChange={(e) => setMaxTrades(Number(e.target.value) || 1)}
                className="input mt-1 w-full"
              />
            </label>
            <button
              onClick={() => void sessionAction("start")}
              disabled={busy || !enabled}
              className="btn btn-primary flex w-full items-center justify-center gap-2 text-sm"
            >
              <Play className="h-4 w-4" /> بدء الجلسة
            </button>
            {!enabled && (
              <p className="text-xs text-amber-500">فعّل السكالب أولاً للبدء.</p>
            )}
          </>
        )}

        {sessionStatus !== "stopped" && session && (
          <>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">الوضع</span>
                <span className="font-medium">
                  {session.execution_mode === "live" ? "حقيقي" : "تجريبي"} ·{" "}
                  {session.market}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">صفقات منفّذة</span>
                <span className="font-medium">
                  {session.executed_count} / {session.max_trades}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">ربح/خسارة الجلسة</span>
                <span
                  className={`font-semibold ${
                    session.session_pnl >= 0 ? "text-emerald-500" : "text-rose-500"
                  }`}
                  dir="ltr"
                >
                  {session.session_pnl >= 0 ? "+" : ""}
                  {session.session_pnl.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              {sessionStatus === "active" ? (
                <button
                  onClick={() => void sessionAction("pause")}
                  disabled={busy}
                  className="btn btn-secondary flex flex-1 items-center justify-center gap-2 text-sm"
                >
                  <Pause className="h-4 w-4" /> إيقاف مؤقت
                </button>
              ) : (
                <button
                  onClick={() => void sessionAction("resume")}
                  disabled={busy}
                  className="btn btn-primary flex flex-1 items-center justify-center gap-2 text-sm"
                >
                  <RotateCw className="h-4 w-4" /> استئناف
                </button>
              )}
              <button
                onClick={() => void sessionAction("stop")}
                disabled={busy}
                className="btn btn-danger flex flex-1 items-center justify-center gap-2 text-sm"
              >
                <Square className="h-4 w-4" /> إيقاف
              </button>
            </div>
          </>
        )}

        {session?.stop_reason && sessionStatus === "stopped" && (
          <p className="text-xs text-muted-foreground">
            آخر إيقاف: {session.stop_reason}
          </p>
        )}
      </div>

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
