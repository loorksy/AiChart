"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, Receipt, Tags, Wallet } from "lucide-react";

import { Badge } from "@/components/squareui/badge";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";
import { cn } from "@/lib/utils";
import {
  AdminCard,
  AdminCardBody,
  AdminCardHeader,
  AdminPage,
  AdminTable,
  Field,
  InlineAlert,
  RecordCard,
  SectionHeader,
  SortTh,
  Spinner,
  StatGrid,
  StatTile,
  THead,
  Td,
  Th,
  TableEmptyRow,
  TableWrap,
  Tr,
  describedBy,
  sortSign,
  useAdminSort,
} from "@/components/admin/ui/AdminKit";

interface ProfitRow {
  user_id: number;
  email: string;
  tier: string | null;
  status: string | null;
  revenue_usd: number;
  provider_cost_usd: number;
  retail_burn_usd: number;
  events: number;
  gift_months: number;
  profit_usd: number;
}

interface ProfitData {
  ok: boolean;
  per_user: ProfitRow[];
  totals: {
    revenue_usd: number;
    provider_cost_usd: number;
    profit_usd: number;
    system_cost_usd: number;
  };
}

interface PriceRow {
  provider: string;
  model: string;
  input_usd_per_m: number;
  output_usd_per_m: number;
}

/** `natural` = the API's own "least profitable first" ordering. */
type ProfitSortKey =
  | "natural"
  | "email"
  | "revenue_usd"
  | "provider_cost_usd"
  | "profit_usd"
  | "events";

const usd = (v: number) => `$${v.toFixed(2)}`;

const TIERS = ["lite", "plus", "pro", "promax"] as const;

/**
 * V2-A6 (#95, بند 12): the money tab — per-user profitability, manual
 * subscription activation, credit adjustment, and the model price editor.
 */
export function AdminBillingPanel() {
  const [profit, setProfit] = useState<ProfitData | null>(null);
  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const [subUser, setSubUser] = useState("");
  const [subTier, setSubTier] = useState("plus");
  const [subGift, setSubGift] = useState(false);
  const [subTouched, setSubTouched] = useState(false);
  const [adjUser, setAdjUser] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjTouched, setAdjTouched] = useState(false);

  const { key: sortKey, dir, sortProps } = useAdminSort<ProfitSortKey>("natural");

  const load = useCallback(async () => {
    const [profitRes, pricesRes] = await Promise.all([
      fetch("/api/admin/billing/profit"),
      fetch("/api/admin/model-prices"),
    ]);
    if (profitRes.ok) setProfit((await profitRes.json()) as ProfitData);
    if (pricesRes.ok) {
      const data = (await pricesRes.json()) as { prices: PriceRow[] };
      setPrices(data.prices);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(
    url: string,
    body: unknown,
    okMessage: string,
    pendingKey: string,
  ) {
    setMessage(null);
    setFailed(false);
    setPending(pendingKey);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setFailed(!res.ok);
      setMessage(
        res.ok
          ? okMessage
          : (data.error ?? "فشل الطلب — لم يتغيّر شيء. راجع رقم المستخدم ثم أعد المحاولة."),
      );
      if (res.ok) void load();
    } catch {
      setFailed(true);
      setMessage("تعذّر الوصول إلى الخادم — لم يُنفَّذ أي تغيير مالي.");
    } finally {
      setPending(null);
    }
  }

  async function savePrice(row: PriceRow) {
    const key = `price:${row.provider}/${row.model}`;
    setMessage(null);
    setFailed(false);
    setPending(key);
    try {
      const res = await fetch("/api/admin/model-prices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      });
      setFailed(!res.ok);
      setMessage(
        res.ok
          ? `حُدّث سعر ${row.model}`
          : `فشل تحديث سعر ${row.model} — السعر القديم ما زال سارياً.`,
      );
    } catch {
      setFailed(true);
      setMessage("تعذّر الوصول إلى الخادم — لم يُحدَّث أي سعر.");
    } finally {
      setPending(null);
    }
  }

  const rows = useMemo(() => {
    const base = profit?.per_user ?? [];
    if (sortKey === "natural") return base;
    const sign = sortSign(dir);
    return [...base].sort((a, b) => {
      switch (sortKey) {
        case "email":
          return sign * a.email.localeCompare(b.email, "en");
        case "revenue_usd":
          return sign * (a.revenue_usd - b.revenue_usd);
        case "provider_cost_usd":
          return sign * (a.provider_cost_usd - b.provider_cost_usd);
        case "profit_usd":
          return sign * (a.profit_usd - b.profit_usd);
        case "events":
          return sign * (a.events - b.events);
        default:
          return 0;
      }
    });
  }, [profit, sortKey, dir]);

  const subId = Number(subUser.trim());
  const subIdError =
    subTouched && !(Number.isInteger(subId) && subId > 0)
      ? "رقم المستخدم يجب أن يكون عدداً صحيحاً موجباً — انسخه من تبويب «المستخدمون»."
      : undefined;
  const subValid = Number.isInteger(subId) && subId > 0;

  const adjId = Number(adjUser.trim());
  const adjValue = Number(adjAmount.trim());
  const adjIdError =
    adjTouched && !(Number.isInteger(adjId) && adjId > 0)
      ? "رقم المستخدم يجب أن يكون عدداً صحيحاً موجباً."
      : undefined;
  const adjAmountError =
    adjTouched && (!Number.isFinite(adjValue) || adjValue === 0)
      ? "أدخل مبلغاً بالدولار غير الصفر — استخدم سالباً للخصم."
      : undefined;
  const adjReasonError =
    adjTouched && adjReason.trim().length < 5
      ? "السبب إلزامي ولا يقل عن ٥ أحرف — سيظهر في كشف حساب العميل."
      : undefined;
  const adjValid =
    Number.isInteger(adjId) &&
    adjId > 0 &&
    Number.isFinite(adjValue) &&
    adjValue !== 0 &&
    adjReason.trim().length >= 5;

  if (!profit) {
    return (
      <AdminPage dir="rtl">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={6} />
      </AdminPage>
    );
  }

  return (
    <AdminPage dir="rtl" data-testid="admin-billing-panel">
      <SectionHeader
        title="الفوترة والأرباح"
        description="ما تجنيه المنصة، ما تدفعه للمزوّدين، والفرق بينهما لكل حساب."
        icon={Coins}
      />

      {message && <InlineAlert tone={failed ? "error" : "ok"}>{message}</InlineAlert>}

      <StatGrid>
        <StatTile
          index={0}
          icon={Coins}
          label="الإيراد الكلي"
          value={usd(profit.totals.revenue_usd)}
        />
        <StatTile
          index={1}
          icon={Receipt}
          label="تكلفة المزوّدين"
          value={usd(profit.totals.provider_cost_usd)}
        />
        <StatTile
          index={2}
          icon={Wallet}
          label="الربح الصافي"
          value={usd(profit.totals.profit_usd)}
          tone={profit.totals.profit_usd < 0 ? "negative" : "positive"}
        />
        <StatTile
          index={3}
          icon={Receipt}
          label="تكلفة النظام (بلا مستخدم)"
          value={usd(profit.totals.system_cost_usd)}
          hint="استهلاك لا يُنسب إلى حساب بعينه"
        />
      </StatGrid>

      <AdminCard>
        <AdminCardHeader
          title="الربحية لكل مستخدم"
          description="الأقل ربحاً أولاً ما لم تغيّر الترتيب من رأس العمود."
        />

        <div className="space-y-2 p-3 sm:hidden">
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              لا بيانات بعد — تظهر الصفوف مع أول استهلاك أو اشتراك.
            </p>
          ) : (
            rows.map((row, i) => (
              <RecordCard
                key={row.user_id}
                index={i}
                title={row.email}
                subtitle={`#${row.user_id}`}
                badge={
                  <Badge variant={row.profit_usd < 0 ? "destructive" : "secondary"}>
                    <span dir="ltr">{usd(row.profit_usd)}</span>
                  </Badge>
                }
                fields={[
                  {
                    label: "الباقة",
                    value: `${row.tier ?? "—"}${row.gift_months > 0 ? ` (هدية ×${row.gift_months})` : ""}`,
                  },
                  { label: "الإيراد", value: <span dir="ltr">{usd(row.revenue_usd)}</span> },
                  {
                    label: "التكلفة",
                    value: <span dir="ltr">{usd(row.provider_cost_usd)}</span>,
                  },
                  { label: "الأحداث", value: row.events },
                ]}
              />
            ))
          )}
        </div>

        <TableWrap className="hidden sm:block" maxHeight="max-h-[32rem]">
          <AdminTable className="min-w-[44rem]">
            <caption className="sr-only">ربحية كل مستخدم خلال الفترة</caption>
            <THead sticky>
              <tr>
                <SortTh label="المستخدم" {...sortProps("email")} />
                <Th>الباقة</Th>
                <SortTh label="الإيراد" numeric {...sortProps("revenue_usd")} />
                <SortTh label="التكلفة" numeric {...sortProps("provider_cost_usd")} />
                <SortTh label="الربح" numeric {...sortProps("profit_usd")} />
                <SortTh label="الأحداث" numeric {...sortProps("events")} />
              </tr>
            </THead>
            <tbody>
              {rows.length === 0 ? (
                <TableEmptyRow
                  colSpan={6}
                  icon={Coins}
                  title="لا بيانات ربحية بعد"
                  description="تظهر الصفوف مع أول استهلاك أو اشتراك يسجّله أي حساب."
                />
              ) : (
                rows.map((row) => (
                  <Tr key={row.user_id}>
                    <Td>
                      <span className="text-foreground" dir="ltr">
                        {row.email}
                      </span>
                    </Td>
                    <Td className="text-muted-foreground">
                      {row.tier ?? "—"}
                      {row.gift_months > 0 && (
                        <span className="ms-1 text-[10px]">(هدية ×{row.gift_months})</span>
                      )}
                    </Td>
                    <Td numeric dir="ltr">
                      {usd(row.revenue_usd)}
                    </Td>
                    <Td numeric dir="ltr">
                      {usd(row.provider_cost_usd)}
                    </Td>
                    <Td
                      numeric
                      dir="ltr"
                      className={cn(
                        "font-semibold",
                        row.profit_usd < 0 ? "text-sell" : "text-buy",
                      )}
                    >
                      {usd(row.profit_usd)}
                    </Td>
                    <Td numeric className="text-muted-foreground">
                      {row.events}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </AdminTable>
        </TableWrap>
      </AdminCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminCard>
          <AdminCardHeader
            title="تفعيل اشتراك يدوياً"
            description="يمنح رصيد الشهر فوراً ويُسجَّل في كشف الحساب."
          />
          <AdminCardBody>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setSubTouched(true);
                if (!subValid) return;
                void post(
                  "/api/admin/billing/subscription",
                  { user_id: subId, tier: subTier, gift: subGift },
                  "فُعّل الاشتراك ومُنح رصيد الشهر",
                  "sub",
                );
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="رقم المستخدم"
                  htmlFor="bill-sub-user"
                  required
                  error={subIdError}
                >
                  <Input
                    id="bill-sub-user"
                    value={subUser}
                    onChange={(e) => setSubUser(e.target.value)}
                    onBlur={() => setSubTouched(true)}
                    placeholder="User ID"
                    inputMode="numeric"
                    dir="ltr"
                    aria-invalid={subIdError ? true : undefined}
                    aria-describedby={describedBy("bill-sub-user", { error: subIdError })}
                    className="tap-target h-10"
                  />
                </Field>
                <Field label="الباقة" htmlFor="bill-sub-tier">
                  <select
                    id="bill-sub-tier"
                    value={subTier}
                    onChange={(e) => setSubTier(e.target.value)}
                    dir="ltr"
                    className="admin-input focus-ring tap-target h-10 w-full text-sm"
                  >
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <label
                htmlFor="bill-sub-gift"
                className="tap-target flex items-center gap-2 text-sm text-muted-foreground"
              >
                <input
                  id="bill-sub-gift"
                  type="checkbox"
                  checked={subGift}
                  onChange={(e) => setSubGift(e.target.checked)}
                  className="focus-ring size-4 accent-[var(--primary)]"
                />
                شهر هدية (إيراد $0)
              </label>

              <Button type="submit" className="tap-target h-10" disabled={pending === "sub"}>
                {pending === "sub" ? <Spinner /> : null}
                تفعيل
              </Button>
            </form>
          </AdminCardBody>
        </AdminCard>

        <AdminCard>
          <AdminCardHeader
            title="تعديل رصيد"
            description="السبب إلزامي — يظهر للعميل في كشف حسابه."
          />
          <AdminCardBody>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setAdjTouched(true);
                if (!adjValid) return;
                void post(
                  "/api/admin/billing/adjust",
                  {
                    user_id: adjId,
                    amount_usd: adjValue,
                    reason: adjReason,
                  },
                  "عُدّل الرصيد وسُجّل في الكشف",
                  "adj",
                );
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="رقم المستخدم"
                  htmlFor="bill-adj-user"
                  required
                  error={adjIdError}
                >
                  <Input
                    id="bill-adj-user"
                    value={adjUser}
                    onChange={(e) => setAdjUser(e.target.value)}
                    onBlur={() => setAdjTouched(true)}
                    placeholder="User ID"
                    inputMode="numeric"
                    dir="ltr"
                    aria-invalid={adjIdError ? true : undefined}
                    aria-describedby={describedBy("bill-adj-user", { error: adjIdError })}
                    className="tap-target h-10"
                  />
                </Field>
                <Field
                  label="المبلغ بالدولار"
                  htmlFor="bill-adj-amount"
                  required
                  error={adjAmountError}
                  hint="سالب = خصم"
                >
                  <Input
                    id="bill-adj-amount"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                    onBlur={() => setAdjTouched(true)}
                    placeholder="± $"
                    inputMode="decimal"
                    dir="ltr"
                    aria-invalid={adjAmountError ? true : undefined}
                    aria-describedby={describedBy("bill-adj-amount", {
                      hint: true,
                      error: adjAmountError,
                    })}
                    className="tap-target h-10"
                  />
                </Field>
              </div>

              <Field
                label="السبب"
                htmlFor="bill-adj-reason"
                required
                error={adjReasonError}
              >
                <Input
                  id="bill-adj-reason"
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  onBlur={() => setAdjTouched(true)}
                  placeholder="تعويض عن انقطاع الخدمة…"
                  aria-invalid={adjReasonError ? true : undefined}
                  aria-describedby={describedBy("bill-adj-reason", {
                    error: adjReasonError,
                  })}
                  className="tap-target h-10"
                />
              </Field>

              <Button type="submit" className="tap-target h-10" disabled={pending === "adj"}>
                {pending === "adj" ? <Spinner /> : null}
                تنفيذ
              </Button>
            </form>
          </AdminCardBody>
        </AdminCard>
      </div>

      {prices && (
        <AdminCard>
          <AdminCardHeader
            title="أسعار المودلات"
            description="دولار لكل مليون توكن — تُستخدم في حساب تكلفة كل طلب."
          />

          <div className="space-y-2 p-3 sm:hidden">
            {prices.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                لا أسعار مسجّلة بعد.
              </p>
            ) : (
              prices.map((row, i) => (
                <RecordCard
                  key={`${row.provider}/${row.model}`}
                  index={i}
                  title={`${row.provider}/${row.model}`}
                  fields={[
                    {
                      label: "إدخال",
                      value: (
                        <PriceInput
                          id={`m-in-${i}`}
                          label={`سعر إدخال ${row.model}`}
                          value={row.input_usd_per_m}
                          onChange={(v) =>
                            setPrices((prev) =>
                              (prev ?? []).map((p, j) =>
                                j === i ? { ...p, input_usd_per_m: v } : p,
                              ),
                            )
                          }
                        />
                      ),
                    },
                    {
                      label: "إخراج",
                      value: (
                        <PriceInput
                          id={`m-out-${i}`}
                          label={`سعر إخراج ${row.model}`}
                          value={row.output_usd_per_m}
                          onChange={(v) =>
                            setPrices((prev) =>
                              (prev ?? []).map((p, j) =>
                                j === i ? { ...p, output_usd_per_m: v } : p,
                              ),
                            )
                          }
                        />
                      ),
                    },
                  ]}
                  actions={
                    <Button
                      variant="outline"
                      size="sm"
                      className="tap-target"
                      disabled={pending === `price:${row.provider}/${row.model}`}
                      onClick={() => void savePrice(row)}
                    >
                      {pending === `price:${row.provider}/${row.model}` ? <Spinner /> : null}
                      حفظ
                    </Button>
                  }
                />
              ))
            )}
          </div>

          <TableWrap className="hidden sm:block">
            <AdminTable className="min-w-[34rem]">
              <caption className="sr-only">أسعار المودلات لكل مليون توكن</caption>
              <THead>
                <tr>
                  <Th>المودل</Th>
                  <Th>إدخال</Th>
                  <Th>إخراج</Th>
                  <Th className="text-end">إجراءات</Th>
                </tr>
              </THead>
              <tbody>
                {prices.length === 0 ? (
                  <TableEmptyRow
                    colSpan={4}
                    icon={Tags}
                    title="لا أسعار مسجّلة"
                    description="أضف مزوّداً ونموذجاً من الإعدادات لتظهر تسعيرته هنا."
                  />
                ) : (
                  prices.map((row, i) => {
                    const key = `price:${row.provider}/${row.model}`;
                    return (
                      <Tr key={`${row.provider}/${row.model}`}>
                        <Td>
                          <span className="text-foreground" dir="ltr">
                            {row.provider}/{row.model}
                          </span>
                        </Td>
                        <Td>
                          <PriceInput
                            id={`in-${i}`}
                            label={`سعر إدخال ${row.model}`}
                            value={row.input_usd_per_m}
                            onChange={(v) =>
                              setPrices((prev) =>
                                (prev ?? []).map((p, j) =>
                                  j === i ? { ...p, input_usd_per_m: v } : p,
                                ),
                              )
                            }
                          />
                        </Td>
                        <Td>
                          <PriceInput
                            id={`out-${i}`}
                            label={`سعر إخراج ${row.model}`}
                            value={row.output_usd_per_m}
                            onChange={(v) =>
                              setPrices((prev) =>
                                (prev ?? []).map((p, j) =>
                                  j === i ? { ...p, output_usd_per_m: v } : p,
                                ),
                              )
                            }
                          />
                        </Td>
                        <Td>
                          <div className="flex justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              className="tap-target"
                              disabled={pending === key}
                              onClick={() => void savePrice(row)}
                            >
                              {pending === key ? <Spinner /> : null}
                              حفظ
                            </Button>
                          </div>
                        </Td>
                      </Tr>
                    );
                  })
                )}
              </tbody>
            </AdminTable>
          </TableWrap>
        </AdminCard>
      )}
    </AdminPage>
  );
}

function PriceInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      id={id}
      type="number"
      step="0.01"
      min={0}
      dir="ltr"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="tap-target h-9 w-24 text-xs"
    />
  );
}
