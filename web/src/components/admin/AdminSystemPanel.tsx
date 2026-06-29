"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthPayload {
  status: string;
  timestamp: string;
  anthropic: boolean;
  telegram: boolean;
  cron_secret_set: boolean;
  binance_capture?: {
    enabled: boolean;
    chromiumReady: boolean;
    detail: string;
  };
  users: {
    total: number;
    active: number;
    with_binance: number;
  };
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        ok ? "border-green-500/30 bg-green-500/10" : "border-destructive/30 bg-destructive/10",
      )}
    >
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-green-500" />
      ) : (
        <XCircle className="h-4 w-4 text-destructive" />
      )}
      <span>{label}</span>
    </div>
  );
}

export function AdminSystemPanel() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/health");
      if (!res.ok) throw new Error("فشل جلب الحالة");
      setHealth(await res.json());
      setError(null);
    } catch {
      setError("تعذّر الاتصال بخدمة الصحة.");
    }
  }

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">حالة النظام</h2>
        <p className="text-sm text-muted-foreground">
          صحة الخادم، التكاملات، والوكلاء النشطون.
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {health && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusPill ok={health.status === "ok"} label="الخادم يعمل" />
            <StatusPill ok={health.anthropic} label="Claude (Anthropic)" />
            <StatusPill ok={health.telegram} label="بوت تليجرام" />
            <StatusPill ok={health.cron_secret_set} label="Cron / المراقبة 24/7" />
            {health.binance_capture && (
              <StatusPill
                ok={
                  !health.binance_capture.enabled ||
                  health.binance_capture.chromiumReady
                }
                label={
                  health.binance_capture.enabled
                    ? "Playwright Binance"
                    : "Playwright (معطّل)"
                }
              />
            )}
          </div>

          <div className="admin-card p-4 text-sm">
            <p className="text-muted-foreground">
              آخر فحص:{" "}
              <span dir="ltr">{health.timestamp.slice(0, 19).replace("T", " ")}</span>
            </p>
            <p className="mt-2">
              مستخدمون نشطون: {health.users.active} / {health.users.total} ·
              Binance: {health.users.with_binance}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
