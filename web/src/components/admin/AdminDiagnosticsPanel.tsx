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
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CheckCircle2, GitCompare, RefreshCw, ShieldAlert, Stethoscope } from "lucide-react";

import { Badge } from "@/components/squareui/badge";
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
  AdminTable,
  InlineAlert,
  RecordCard,
  SectionHeader,
  SortTh,
  Spinner,
  THead,
  Td,
  Th,
  TableEmptyRow,
  TableWrap,
  Tr,
  sortSign,
  useAdminSort,
} from "@/components/admin/ui/AdminKit";

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

/** `natural` = newest-first as the API returned it. */
type ParitySortKey = "natural" | "symbol" | "createdAt" | "classification";

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

function CriticalTile({
  label,
  metric,
  value,
  index,
}: {
  label: string;
  metric: string;
  value: number;
  index: number;
}) {
  const bad = value > 0;
  return (
    <div
      data-testid={`critical-${metric}`}
      style={{ "--motion-index": index } as CSSProperties}
      className={cn(
        "motion-rise-in motion-stagger rounded-xl border p-3",
        bad ? "border-red-500/50 bg-red-500/10" : "border-emerald-500/30 bg-emerald-500/[0.06]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
        {bad ? (
          <ShieldAlert className="size-4 shrink-0 text-red-500" aria-hidden />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />
        )}
      </div>
      <p
        className={cn(
          "type-numeric mt-1 text-2xl font-bold",
          bad ? "text-red-600 dark:text-red-400" : "text-foreground",
        )}
        dir="ltr"
      >
        {value}
      </p>
      <p className="type-numeric mt-0.5 text-[10px] text-muted-foreground/70" dir="ltr">
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
  const { key: sortKey, dir, sortProps } = useAdminSort<ParitySortKey>("natural");

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
      setError(
        "تعذّر جلب بيانات التشخيص — الأرقام أدناه قد تكون قديمة. تأكّد من تشغيل الخدمة ثم اضغط تحديث.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, []);

  const entries = useMemo(() => {
    const base = parity?.entries ?? [];
    if (sortKey === "natural") return base;
    const sign = sortSign(dir);
    return [...base].sort((a, b) => {
      switch (sortKey) {
        case "symbol":
          return sign * a.symbol.localeCompare(b.symbol, "en");
        case "createdAt":
          return sign * (a.createdAt - b.createdAt);
        case "classification":
          return sign * classificationLabel(a).localeCompare(classificationLabel(b), "ar");
        default:
          return 0;
      }
    });
  }, [parity, sortKey, dir]);

  return (
    <AdminPage dir="rtl" data-testid="admin-diagnostics-panel">
      <SectionHeader
        title="تشخيص الوكيل الموحّد"
        description="عدّادات الثوابت الحرجة (قيمتها الصحيحة صفر)، ثم العدّادات التشغيلية، ثم سجل التطابق بين المنصة و MCP."
        icon={Stethoscope}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="tap-target"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? <Spinner /> : <RefreshCw className="size-3.5" aria-hidden />}
            تحديث
          </Button>
        }
      />

      {error && <InlineAlert tone="error">{error}</InlineAlert>}

      {!diag ? (
        <>
          <StatTilesSkeleton count={4} />
          <CardSkeleton lines={5} />
        </>
      ) : (
        <>
          {/* 1 — critical counters, red on anything above zero. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CRITICAL_LABELS.map((item, i) => (
              <CriticalTile
                key={item.metric}
                index={i}
                label={item.label}
                metric={item.metric}
                value={Number(diag.critical[item.key] ?? 0)}
              />
            ))}
          </div>

          {/* 2 — the rest of the counters. */}
          <AdminCard>
            <AdminCardHeader title="العدّادات التشغيلية" />
            <AdminCardBody>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(diag.counters).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 border-b border-border/40 pb-1.5 text-sm"
                  >
                    <dt className="text-muted-foreground">{COUNTER_LABELS[key] ?? key}</dt>
                    <dd className="type-numeric font-semibold" dir="ltr">
                      {value}
                    </dd>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-1.5 text-sm">
                  <dt className="text-muted-foreground">تنبيهات حرجة (إجمالي)</dt>
                  <dd className="type-numeric font-semibold" dir="ltr">
                    {diag.critical.criticalAlerts}
                  </dd>
                </div>
              </dl>

              {Object.keys(diag.reevaluation).length > 0 && (
                <div className="mt-4">
                  <h4 className="type-overline">نتائج إعادة التقييم</h4>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {Object.entries(diag.reevaluation).map(([key, value]) => (
                      <Badge key={key} variant="outline">
                        {key}: <span dir="ltr">{value}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(diag.caseMemory).length > 0 && (
                <div className="mt-3">
                  <h4 className="type-overline">ذاكرة الحالات</h4>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {Object.entries(diag.caseMemory).map(([key, value]) => (
                      <Badge key={key} variant="outline">
                        {key}: <span dir="ltr">{value}</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </AdminCardBody>
          </AdminCard>
        </>
      )}

      {/* 3 — parity log, classification per row. */}
      {parity && (
        <AdminCard>
          <AdminCardHeader
            title="سجل التطابق (المنصة مقابل MCP)"
            actions={
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">
                  مقارنات: <span dir="ltr">{parity.totals.compared}</span>
                </Badge>
                <Badge variant="outline">
                  متطابقة: <span dir="ltr">{parity.totals.identical}</span>
                </Badge>
                <Badge variant="outline">
                  مختلفة: <span dir="ltr">{parity.totals.differing}</span>
                </Badge>
                <Badge
                  variant={parity.totals.unexplained > 0 ? "destructive" : "outline"}
                >
                  غير مفسَّرة: <span dir="ltr">{parity.totals.unexplained}</span>
                </Badge>
                <Badge variant="outline">
                  أحادية الجانب: <span dir="ltr">{parity.unpaired}</span>
                </Badge>
              </div>
            }
          />

          <div className="space-y-2 p-3 sm:hidden">
            {entries.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                لا لحظات قرار مشتركة بعد.
              </p>
            ) : (
              entries.map((entry, i) => (
                <RecordCard
                  key={`${entry.evidenceHash}-${entry.createdAt}`}
                  index={i}
                  title={entry.symbol}
                  subtitle={entry.timeframeSet.join(", ")}
                  badge={
                    <span className={cn("text-xs", classificationTone(entry))}>
                      {classificationLabel(entry)}
                    </span>
                  }
                  fields={[
                    {
                      label: "قرار المنصة",
                      value: <span dir="ltr">{decisionSummary(entry.platform)}</span>,
                    },
                    {
                      label: "قرار MCP",
                      value: <span dir="ltr">{decisionSummary(entry.mcp)}</span>,
                    },
                    {
                      label: "الحقول المختلفة",
                      value: (
                        <span dir="ltr">
                          {entry.comparison.differingFields.join(", ") || "—"}
                        </span>
                      ),
                    },
                  ]}
                />
              ))
            )}
          </div>

          <TableWrap className="hidden sm:block" maxHeight="max-h-[34rem]">
            <AdminTable className="min-w-[46rem] text-[12px]">
              <caption className="sr-only">
                مقارنة قرارات المنصة و MCP على نفس الأدلة
              </caption>
              <THead sticky>
                <tr>
                  <SortTh label="الرمز" {...sortProps("symbol")} />
                  <Th>الأطر</Th>
                  <Th>قرار المنصة</Th>
                  <Th>قرار MCP</Th>
                  <Th>الحقول المختلفة</Th>
                  <SortTh label="التصنيف" {...sortProps("classification")} />
                  <SortTh label="الوقت" {...sortProps("createdAt")} />
                </tr>
              </THead>
              <tbody>
                {entries.length === 0 ? (
                  <TableEmptyRow
                    colSpan={7}
                    icon={GitCompare}
                    title="لا لحظات قرار مشتركة بعد"
                    description="يظهر صف هنا كلما اتخذت المنصة و MCP قراراً على نفس الأدلة."
                  />
                ) : (
                  entries.map((entry) => (
                    <Tr
                      key={`${entry.evidenceHash}-${entry.createdAt}`}
                      className={
                        entry.comparison.classification === "unexplained"
                          ? "bg-red-500/[0.06]"
                          : undefined
                      }
                    >
                      <Td className="type-numeric">{entry.symbol}</Td>
                      <Td className="text-muted-foreground" dir="ltr">
                        {entry.timeframeSet.join(", ")}
                      </Td>
                      <Td className="text-muted-foreground" dir="ltr">
                        {decisionSummary(entry.platform)}
                      </Td>
                      <Td className="text-muted-foreground" dir="ltr">
                        {decisionSummary(entry.mcp)}
                      </Td>
                      <Td className="type-numeric text-[11px] text-muted-foreground" dir="ltr">
                        {entry.comparison.differingFields.join(", ") || "—"}
                      </Td>
                      <Td className={classificationTone(entry)}>
                        {classificationLabel(entry)}
                        {entry.comparison.explanation && !entry.comparison.identical ? (
                          <span className="block text-[10px] text-muted-foreground/80">
                            {entry.comparison.explanation}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="type-numeric whitespace-nowrap text-[11px] text-muted-foreground" dir="ltr">
                        {new Date(entry.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </AdminTable>
          </TableWrap>
        </AdminCard>
      )}
    </AdminPage>
  );
}
