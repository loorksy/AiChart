import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Power,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { listAgentAuditLogs, listRecommendations } from "@/lib/store";
import { isAgentBridgeConfigured } from "@/lib/agentAuth";
import AppShell from "@/components/AppShell";
import { PageLayout, SurfaceCard } from "@/components/ui/shell";
import { AgentStatusBar } from "@/components/dashboard/AgentStatusBar";

export const dynamic = "force-dynamic";

const ACTION_META: Record<string, { label: string; icon: typeof Activity }> = {
  agent_recommendation: { label: "توصية من الوكيل", icon: BarChart3 },
  agent_trade_open: { label: "فتح صفقة", icon: ArrowUpRight },
  agent_trade_close: { label: "إغلاق صفقة", icon: ArrowDownLeft },
  agent_mode_change: { label: "تبديل الوضع", icon: SlidersHorizontal },
  agent_kill_switch: { label: "Kill Switch", icon: Power },
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso.includes("T") ? iso : `${iso}Z`).toLocaleString(
      "ar-EG",
      { dateStyle: "short", timeStyle: "short" },
    );
  } catch {
    return iso;
  }
}

export default async function AgentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/agent");

  const [activity, recommendations] = await Promise.all([
    listAgentAuditLogs(user.id, 50),
    listRecommendations(user.id, 30),
  ]);
  const agentRecs = recommendations.filter((r) => r.source === "agent");

  return (
    <AppShell email={user.email} role={user.role}>
      <PageLayout
        title="الوكيل"
        subtitle="نشاط وكيل OpenClaw — توصياته وصفقاته وقراراته"
        maxWidth="6xl"
      >
        <AgentStatusBar />

        {user.role === "admin" && (
          <SurfaceCard className="border-border/80">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Settings2 className="h-4 w-4 text-muted-foreground" />
                  إعدادات OpenClaw
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Control Web UI — Config، قنوات، tools، موافقات exec.
                </p>
              </div>
              <Link href="/agent/console" className="btn btn-primary shrink-0">
                فتح اللوحة
              </Link>
            </div>
          </SurfaceCard>
        )}

        {!isAgentBridgeConfigured() && (
          <SurfaceCard className="border-accent-gold/40 bg-accent-gold/5 text-sm">
            <p className="font-semibold">جسر الوكيل غير مفعّل</p>
            <p className="mt-1 text-muted-foreground">
              عيّن <code dir="ltr">AICHART_SERVICE_TOKEN</code> في بيئة المنصة،
              ثم ثبّت OpenClaw وشغّل المزامنة — التفاصيل في{" "}
              <code dir="ltr">agent/README.md</code>.
            </p>
          </SurfaceCard>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── Activity timeline ── */}
          <SurfaceCard>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Activity className="h-4 w-4 text-muted-foreground" />
              سجل النشاط
            </h2>
            {activity.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                لا نشاط بعد — سيظهر هنا كل ما يفعله الوكيل عبر الجسر.
              </p>
            ) : (
              <ul className="space-y-1">
                {activity.map((a) => {
                  const meta = ACTION_META[a.action] ?? {
                    label: a.action,
                    icon: Activity,
                  };
                  const Icon = meta.icon;
                  return (
                    <li
                      key={a.id}
                      className="flex items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-secondary/50"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {meta.label}
                        </span>
                        {a.detail && (
                          <span
                            className="block truncate text-xs text-muted-foreground"
                            dir="auto"
                          >
                            {a.detail}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatWhen(a.created_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SurfaceCard>

          {/* ── Agent recommendations ── */}
          <SurfaceCard>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              توصيات الوكيل
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                🤖 وكيل
              </span>
            </h2>
            {agentRecs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                لا توصيات من الوكيل بعد.
              </p>
            ) : (
              <ul className="space-y-2">
                {agentRecs.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-border/60 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <b dir="ltr">{r.symbol}</b>
                      <span
                        className={
                          r.action === "buy"
                            ? "rounded-full bg-chart-1/10 px-2 py-0.5 text-xs font-semibold text-chart-1"
                            : r.action === "sell"
                              ? "rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive"
                              : "rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                        }
                      >
                        {r.action === "buy"
                          ? "شراء"
                          : r.action === "sell"
                            ? "بيع"
                            : "انتظار"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ثقة {r.confidence}%
                        {r.timeframe ? ` · ${r.timeframe}` : ""}
                      </span>
                      <span className="ms-auto text-[11px] text-muted-foreground">
                        {formatWhen(r.created_at)}
                      </span>
                    </div>
                    {r.rationale && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {r.rationale}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground" dir="ltr">
                      {r.entry != null && <span>دخول {r.entry}</span>}
                      {r.stop_loss != null && <span>وقف {r.stop_loss}</span>}
                      {r.take_profit != null && <span>هدف {r.take_profit}</span>}
                      {r.chart_image_url && (
                        <Link
                          href={r.chart_image_url}
                          target="_blank"
                          className="text-link font-medium"
                        >
                          عرض الشارت
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SurfaceCard>
        </div>
      </PageLayout>
    </AppShell>
  );
}
