"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { CheckCircle2, RefreshCw, Server, XCircle } from "lucide-react";

import { Button } from "@/components/squareui/button";
import {
  CardSkeleton,
  StatTilesSkeleton,
} from "@/components/ui/skeletons/page-skeletons";
import { cn } from "@/lib/utils";
import {
  AdminCard,
  AdminCardBody,
  AdminCardHeader,
  AdminPage,
  InlineAlert,
  SectionHeader,
  Spinner,
} from "@/components/admin/ui/AdminKit";

interface HealthPayload {
  status: string;
  timestamp: string;
  llm: boolean;
  ai_provider?: string;
  telegram: boolean;
  cron_secret_set: boolean;
  users: {
    total: number;
    active: number;
  };
}

/**
 * One integration's state. The dot carries the meaning for colour-blind users
 * via the icon beside it, never colour alone.
 */
function StatusPill({
  ok,
  label,
  hint,
  index,
}: {
  ok: boolean;
  label: string;
  hint?: string;
  index: number;
}) {
  return (
    <div
      style={{ "--motion-index": index } as CSSProperties}
      className={cn(
        "motion-rise-in motion-stagger elevation-1 flex items-start gap-3 rounded-[var(--radius-lg)] border p-4",
        ok
          ? "border-emerald-500/30 bg-emerald-500/[0.07]"
          : "border-destructive/40 bg-destructive/10",
      )}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          {hint ?? (ok ? "يعمل" : "متوقف — يحتاج تدخّلاً")}
        </p>
      </div>
    </div>
  );
}

export function AdminSystemPanel() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/health");
      if (!res.ok) throw new Error("فشل جلب الحالة");
      setHealth(await res.json());
      setError(null);
    } catch {
      setError(
        "تعذّر الاتصال بخدمة الصحة — القراءة أدناه قد تكون قديمة. تحقّق من تشغيل الخادم ثم أعد المحاولة.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Health is a live reading; a 15s poll is what makes this screen worth
    // leaving open on a second monitor.
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <AdminPage dir="rtl" data-testid="admin-system-panel">
      <SectionHeader
        title="حالة النظام"
        description="صحة الخادم، التكاملات، والوكلاء النشطون — تُحدَّث تلقائياً كل ١٥ ثانية."
        icon={Server}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="tap-target"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? (
              <Spinner />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden />
            )}
            تحديث
          </Button>
        }
      />

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {!health ? (
        <>
          <StatTilesSkeleton count={4} />
          <CardSkeleton lines={2} />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusPill index={0} ok={health.status === "ok"} label="الخادم يعمل" />
            <StatusPill
              index={1}
              ok={health.llm}
              label="مزوّد الذكاء الاصطناعي"
              hint={
                health.ai_provider
                  ? `${health.ai_provider}${health.llm ? " — مفتاح صالح" : " — لا مفتاح صالح"}`
                  : undefined
              }
            />
            <StatusPill index={2} ok={health.telegram} label="بوت تليجرام" />
            <StatusPill
              index={3}
              ok={health.cron_secret_set}
              label="Cron / المراقبة 24/7"
              hint={
                health.cron_secret_set
                  ? "السر مضبوط — المهام المجدولة تعمل"
                  : "اضبط CRON_SECRET من تبويب المفاتيح"
              }
            />
          </div>

          <AdminCard>
            <AdminCardHeader title="لقطة الحالة" />
            <AdminCardBody className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="type-caption">آخر فحص</p>
                <p className="type-numeric mt-0.5 text-sm text-foreground" dir="ltr">
                  {health.timestamp.slice(0, 19).replace("T", " ")}
                </p>
              </div>
              <div>
                <p className="type-caption">مستخدمون نشطون</p>
                <p className="type-numeric mt-0.5 text-sm text-foreground" dir="ltr">
                  {health.users.active} / {health.users.total}
                </p>
              </div>
            </AdminCardBody>
          </AdminCard>
        </>
      )}
    </AdminPage>
  );
}
