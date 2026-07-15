"use client";

import { useEffect, useState } from "react";
import SettingsClient from "@/components/SettingsClient";
import type { ComponentProps } from "react";
import { Shield, Lock, Activity } from "lucide-react";

type Props = Omit<
  ComponentProps<typeof SettingsClient>,
  "embedMode" | "visibleTabs" | "initialTab"
>;

type GuardSnapshot = {
  resolved?: {
    precedenceVersion?: string;
    perTradePct?: number;
    maxOpenTrades?: number;
    dailyLossLimitPct?: number;
    minRr?: number;
    canAutoExecute?: boolean;
    executionEnvPreference?: string;
    mode?: string;
    immutable?: Record<string, boolean | number>;
  };
  limits?: {
    max_capital_cap?: number;
    max_open_trades_cap?: number;
    can_execute?: number;
  };
};

/**
 * Dedicated Risk Settings surface — reuses the canonical trading settings form
 * and Risk Guard. No parallel risk engine.
 */
export function RiskSection(props: Props) {
  const [guard, setGuard] = useState<GuardSnapshot | null>(null);

  useEffect(() => {
    void fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setGuard(d))
      .catch(() => setGuard(null));
  }, []);

  const resolved = guard?.resolved;
  const immutable = resolved?.immutable;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-3 py-4 md:px-6" dir="rtl">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Shield className="h-6 w-6" />
          إعدادات المخاطر
        </h1>
        <p className="text-sm text-muted-foreground">
          تفضيلاتك قابلة للتشديد فقط — حدود المنصة والإدارة لا يمكن إضعافها.
          التحليل والتنفيذ يستخدمان نفس الحدود المحلولة.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4" />
            حالة الحراسة الحالية
          </h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>نسخة الأولوية: {resolved?.precedenceVersion ?? "—"}</li>
            <li>وضع التنفيذ: {resolved?.mode ?? props.settings.mode}</li>
            <li>
              بيئة الحساب:{" "}
              {resolved?.executionEnvPreference ??
                props.settings.execution_env_preference}
            </li>
            <li>
              تنفيذ تلقائي مسموح:{" "}
              {resolved?.canAutoExecute || props.limits.can_execute
                ? "نعم (ضمن الحدود)"
                : "لا — موافقة يدوية"}
            </li>
            <li>
              مخاطرة الصفقة: {resolved?.perTradePct ?? props.settings.per_trade_pct}%
            </li>
            <li>
              الحد اليومي للخسارة:{" "}
              {resolved?.dailyLossLimitPct ?? props.settings.daily_loss_limit_pct}%
            </li>
            <li>حد أدنى R:R: {resolved?.minRr ?? props.settings.min_rr}</li>
            <li>
              سقف الصفقات:{" "}
              {resolved?.maxOpenTrades ?? props.settings.max_open_trades} (سقف
              الأدمن: {props?.limits?.max_open_trades_cap ?? props.limits.max_open_trades_cap})
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Lock className="h-4 w-4" />
            حماية غير قابلة للإضعاف
          </h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>وقف خسارة إلزامي على كل صفقة</li>
            <li>رفض الأسعار الراكدة</li>
            <li>مطابقة بيئة تجريبي/حقيقي</li>
            <li>تأكيد صريح قبل التنفيذ الحقيقي</li>
            <li>أوامر متكررة (idempotent)</li>
            <li>
              سقف منصة لحجم الصفقة:{" "}
              {immutable?.maxPerTradePctCeiling ?? 10}%
            </li>
            <li>
              سقف منصة للخسارة اليومية:{" "}
              {immutable?.maxDailyLossPctCeiling ?? 20}%
            </li>
            <li>
              صلاحية التنفيذ التلقائي:{" "}
              {props?.limits?.can_execute ?? props.limits.can_execute
                ? "ممنوحة من الإدارة"
                : "غير ممنوحة"}
            </li>
          </ul>
        </div>
      </section>

      <SettingsClient
        {...props}
        embedMode
        visibleTabs={["trading"]}
        initialTab="trading"
      />
    </div>
  );
}
