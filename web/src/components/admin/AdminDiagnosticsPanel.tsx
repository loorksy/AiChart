"use client";

/**
 * Unified-agent diagnostics (plan §17, Group 9) over GET /api/admin/diagnostics
 * and GET /api/admin/parity.
 *
 * Order is the point: the critical counters whose correct value is ZERO come
 * first and turn red on any other value — hidden WAIT writes, wrong-mode
 * executions, plan edits outside the revision mechanism, unexplained parity.
 * Then the operational counters, then the parity log with each row's
 * classification, because an explained difference is normal and an unexplained
 * one means the two surfaces are not running the same decision path.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface DiagnosticsPayload {
  critical: {
    hiddenWaitWrites: number;
    executionInWrongMode: number;
    planEditOutsideRevisions?: number;
    unexplainedParity: number;
    criticalAlerts: number;
  };
  parity: {
    totals: {
      compared: number;
      identical: number;
      differing: number;
      unexplained: number;
      byClassification: Record<string, number>;
    };
    unpaired: number;
  };
  reevaluation: Record<string, number>;
  caseMemory: Record<string, number>;
  counters: Record<string, number>;
  featureFlags: Record<string, boolean>;
}

interface ParityDecisionView {
  direction: string | null;
  planType: string | null;
  executionState: string | null;
  blocked?: boolean;
}

interface ParityEntry {
  evidenceHash: string;
  symbol: string;
  timeframeSet: string[];
  platform: ParityDecisionView;
  mcp: ParityDecisionView;
  comparison: {
    identical: boolean;
    differingFields: string[];
    classification: string | null;
    explanation: string;
    explained: boolean;
  };
  createdAt: number;
}

interface ParityPayload {
  unexplained: number;
  totals: DiagnosticsPayload["parity"]["totals"];
  unpaired: number;
  entries: ParityEntry[];
}

const CRITICAL_LABELS: Array<{
  key: keyof DiagnosticsPayload["critical"];
  metric: string;
  label: string;
}> = [
  { key: "hiddenWaitWrites", metric: "hidden_wait_write", label: "كتابات WAIT خفية" },
  { key: "executionInWrongMode", metric: "execution_wrong_mode", label: "تنفيذ خارج الوضع المصرّح" },
  {
    key: "planEditOutsideRevisions",
    metric: "plan_edit_outside_revisions",
    label: "تعديل خطة خارج آلية المراجعات",
  },
  { key: "unexplainedParity", metric: "unexplained_parity", label: "تباين غير مفسَّر بين المنصتين" },
];

const COUNTER_LABELS: Record<string, string> = {
  completeContracts: "عقود تحليل مكتملة",
  invalidLevelRecommendations: "توصيات بمستويات غير صالحة",
  staleRevisionDenials: "رفض تنفيذ لمراجعة قديمة",
  duplicateNotificationsSuppressed: "إشعارات مكررة مكتومة",
  reevaluationCycles: "دورات إعادة تقييم",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  identical: "متطابق",
  different_evidence_hash: "أدلة مختلفة",
  different_market_timestamp: "توقيت سوق مختلف",
  missing_image: "صورة ناقصة",
  missing_provider: "مزوّد ناقص",
  model_nondeterminism: "اختلاف نموذج",
  contract_mismatch: "خلل عقد",
  unexplained: "غير مفسَّر",
};

function classificationLabel(entry: ParityEntry): string {
  if (entry.comparison.identical) return CLASSIFICATION_LABELS.identical!;
  return (
    CLASSIFICATION_LABELS[entry.comparison.classification ?? ""] ??
    entry.comparison.classification ??
    "—"
  );
}

function classificationTone(entry: ParityEntry): string {
  if (entry.comparison.identical) return "text-emerald-600 dark:text-emerald-400";
  if (entry.comparison.classification === "unexplained")
    return "font-semibold text-red-600 dark:text-red-400";
  if (entry.comparison.classification === "contract_mismatch")
    return "font-semibold text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

function CriticalTile({ label, metric, value }: { label: string; metric: string; value: number }) {
  const bad = value > 0;
  return (
    <div
      data-testid={`critical-${metric}`}
      className={cn(
        "rounded-xl border p-3",
        bad ? "border-red-500/50 bg-red-500/10" : "border-emerald-500/30 bg-emerald-500/[0.06]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
        {bad ? (
          <ShieldAlert className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
        )}
      </div>
      <p
        className={cn(
          "mt-1 font-mono text-2xl font-bold",
          bad ? "text-red-600 dark:text-red-400" : "text-foreground",
        )}
        dir="ltr"
      >
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70" dir="ltr">
        {metric} · target 0
      </p>
    </div>
  );
}

function decisionSummary(decision: ParityDecisionView): string {
  if (decision.blocked) return "محجوب";
  const parts = [decision.direction, decision.planType, decision.executionState].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

export function AdminDiagnosticsPanel() {
  const [diag, setDiag] = useState<DiagnosticsPayload | null>(null);
  const [parity, setParity] = useState<ParityPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const [diagRes, parityRes] = await Promise.all([
        fetch("/api/admin/diagnostics", { cache: "no-store" }),
        fetch("/api/admin/parity?limit=100", { cache: "no-store" }),
      ]);
      if (!diagRes.ok || !parityRes.ok) throw new Error("fetch failed");
      setDiag((await diagRes.json()) as DiagnosticsPayload);
      setParity((await parityRes.json()) as ParityPayload);
      setError(null);
    } catch {
      setError("تعذّر جلب بيانات التشخيص.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">تشخيص الوكيل الموحّد</h2>
          <p className="text-sm text-muted-foreground">
            عدّادات الثوابت الحرجة (قيمتها الصحيحة صفر)، ثم العدّادات التشغيلية، ثم سجل التطابق
            بين المنصة و MCP.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden />
          تحديث
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {diag && (
        <>
          {/* 1 — critical counters, red on anything above zero. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CRITICAL_LABELS.map((item) => (
              <CriticalTile
                key={item.metric}
                label={item.label}
                metric={item.metric}
                value={Number(diag.critical[item.key] ?? 0)}
              />
            ))}
          </div>

          {/* 2 — the rest of the counters. */}
          <div className="admin-card p-4">
            <h3 className="text-sm font-bold">العدّادات التشغيلية</h3>
            <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(diag.counters).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{COUNTER_LABELS[key] ?? key}</span>
                  <span className="font-mono font-semibold" dir="ltr">
                    {value}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">تنبيهات حرجة (إجمالي)</span>
                <span className="font-mono font-semibold" dir="ltr">
                  {diag.critical.criticalAlerts}
                </span>
              </div>
            </div>
            {Object.keys(diag.reevaluation).length > 0 && (
              <div className="mt-4">
                <h4 className="text-[12px] font-semibold text-muted-foreground">
                  نتائج إعادة التقييم
                </h4>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {Object.entries(diag.reevaluation).map(([key, value]) => (
                    <span
                      key={key}
                      className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]"
                    >
                      {key}: <span dir="ltr">{value}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {Object.keys(diag.caseMemory).length > 0 && (
              <div className="mt-3">
                <h4 className="text-[12px] font-semibold text-muted-foreground">ذاكرة الحالات</h4>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {Object.entries(diag.caseMemory).map(([key, value]) => (
                    <span
                      key={key}
                      className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]"
                    >
                      {key}: <span dir="ltr">{value}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* 3 — parity log, classification per row. */}
      {parity && (
        <div className="admin-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold">سجل التطابق (المنصة مقابل MCP)</h3>
            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              <span>مقارنات: <span dir="ltr">{parity.totals.compared}</span></span>
              <span>متطابقة: <span dir="ltr">{parity.totals.identical}</span></span>
              <span>مختلفة: <span dir="ltr">{parity.totals.differing}</span></span>
              <span
                className={cn(
                  parity.totals.unexplained > 0 &&
                    "font-semibold text-red-600 dark:text-red-400",
                )}
              >
                غير مفسَّرة: <span dir="ltr">{parity.totals.unexplained}</span>
              </span>
              <span>أحادية الجانب: <span dir="ltr">{parity.unpaired}</span></span>
            </div>
          </div>

          {parity.entries.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">لا لحظات قرار مشتركة بعد.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[44rem] text-[12px]">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground">
                    <th className="py-1.5 text-start font-medium">الرمز</th>
                    <th className="py-1.5 text-start font-medium">الأطر</th>
                    <th className="py-1.5 text-start font-medium">قرار المنصة</th>
                    <th className="py-1.5 text-start font-medium">قرار MCP</th>
                    <th className="py-1.5 text-start font-medium">الحقول المختلفة</th>
                    <th className="py-1.5 text-start font-medium">التصنيف</th>
                  </tr>
                </thead>
                <tbody>
                  {parity.entries.map((entry) => (
                    <tr
                      key={`${entry.evidenceHash}-${entry.createdAt}`}
                      className={cn(
                        "border-b border-border/40",
                        entry.comparison.classification === "unexplained" && "bg-red-500/[0.06]",
                      )}
                    >
                      <td className="py-1.5 font-mono">{entry.symbol}</td>
                      <td className="py-1.5 text-muted-foreground" dir="ltr">
                        {entry.timeframeSet.join(", ")}
                      </td>
                      <td className="py-1.5 text-muted-foreground" dir="ltr">
                        {decisionSummary(entry.platform)}
                      </td>
                      <td className="py-1.5 text-muted-foreground" dir="ltr">
                        {decisionSummary(entry.mcp)}
                      </td>
                      <td className="py-1.5 font-mono text-[11px] text-muted-foreground" dir="ltr">
                        {entry.comparison.differingFields.join(", ") || "—"}
                      </td>
                      <td className={cn("py-1.5", classificationTone(entry))}>
                        {classificationLabel(entry)}
                        {entry.comparison.explanation && !entry.comparison.identical ? (
                          <span className="block text-[10px] text-muted-foreground/80">
                            {entry.comparison.explanation}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
