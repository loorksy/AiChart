"use client";

import { useCallback, useEffect, useState } from "react";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";

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

const usd = (v: number) => `$${v.toFixed(2)}`;

/**
 * V2-A6 (#95, بند 12): the money tab — per-user profitability, manual
 * subscription activation, credit adjustment, and the model price editor.
 */
export function AdminBillingPanel() {
  const [profit, setProfit] = useState<ProfitData | null>(null);
  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [subUser, setSubUser] = useState("");
  const [subTier, setSubTier] = useState("plus");
  const [subGift, setSubGift] = useState(false);
  const [adjUser, setAdjUser] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");

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

  async function post(url: string, body: unknown, okMessage: string) {
    setMessage(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setMessage(res.ok ? okMessage : (data.error ?? "فشل الطلب"));
    if (res.ok) void load();
  }

  async function savePrice(row: PriceRow) {
    setMessage(null);
    const res = await fetch("/api/admin/model-prices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    setMessage(res.ok ? `حُدّث سعر ${row.model}` : "فشل تحديث السعر");
  }

  if (!profit) return <CardSkeleton lines={6} />;

  return (
    <div className="space-y-6" dir="rtl">
      {message && (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-2 text-sm text-foreground">
          {message}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "الإيراد الكلي", value: usd(profit.totals.revenue_usd) },
          { label: "تكلفة المزوّدين", value: usd(profit.totals.provider_cost_usd) },
          { label: "الربح الصافي", value: usd(profit.totals.profit_usd) },
          { label: "تكلفة النظام (بلا مستخدم)", value: usd(profit.totals.system_cost_usd) },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] text-muted-foreground">{tile.label}</p>
            <p className="mt-1 text-xl font-bold text-foreground">{tile.value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-x-auto rounded-xl border border-border bg-card">
        <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
          الربحية لكل مستخدم (الأقل ربحاً أولاً)
        </h3>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border/60 text-right text-[11px] text-muted-foreground">
              <th className="px-4 py-2">المستخدم</th>
              <th className="px-2 py-2">الباقة</th>
              <th className="px-2 py-2">الإيراد</th>
              <th className="px-2 py-2">التكلفة</th>
              <th className="px-2 py-2">الربح</th>
              <th className="px-2 py-2">الأحداث</th>
            </tr>
          </thead>
          <tbody>
            {profit.per_user.map((row) => (
              <tr key={row.user_id} className="border-b border-border/40">
                <td className="px-4 py-2 text-foreground">{row.email}</td>
                <td className="px-2 py-2 text-muted-foreground">
                  {row.tier ?? "—"}
                  {row.gift_months > 0 && (
                    <span className="mr-1 text-[10px]">(هدية ×{row.gift_months})</span>
                  )}
                </td>
                <td className="px-2 py-2">{usd(row.revenue_usd)}</td>
                <td className="px-2 py-2">{usd(row.provider_cost_usd)}</td>
                <td
                  className={`px-2 py-2 font-semibold ${row.profit_usd < 0 ? "text-destructive" : "text-emerald-500"}`}
                >
                  {usd(row.profit_usd)}
                </td>
                <td className="px-2 py-2 text-muted-foreground">{row.events}</td>
              </tr>
            ))}
            {profit.per_user.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  لا بيانات بعد — تظهر الصفوف مع أول استهلاك أو اشتراك.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">تفعيل اشتراك يدوياً</h3>
          <div className="flex flex-wrap gap-2">
            <input
              value={subUser}
              onChange={(e) => setSubUser(e.target.value)}
              placeholder="User ID"
              className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <select
              value={subTier}
              onChange={(e) => setSubTier(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {["lite", "plus", "pro", "promax"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={subGift}
                onChange={(e) => setSubGift(e.target.checked)}
              />
              شهر هدية (إيراد $0)
            </label>
            <button
              onClick={() =>
                post(
                  "/api/admin/billing/subscription",
                  { user_id: Number(subUser), tier: subTier, gift: subGift },
                  "فُعّل الاشتراك ومُنح رصيد الشهر",
                )
              }
              disabled={!subUser}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              تفعيل
            </button>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">تعديل رصيد (السبب إلزامي)</h3>
          <div className="flex flex-wrap gap-2">
            <input
              value={adjUser}
              onChange={(e) => setAdjUser(e.target.value)}
              placeholder="User ID"
              className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <input
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              placeholder="± $"
              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <input
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="السبب"
              className="min-w-40 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <button
              onClick={() =>
                post(
                  "/api/admin/billing/adjust",
                  {
                    user_id: Number(adjUser),
                    amount_usd: Number(adjAmount),
                    reason: adjReason,
                  },
                  "عُدّل الرصيد وسُجّل في الكشف",
                )
              }
              disabled={!adjUser || !adjAmount || adjReason.length < 5}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              تنفيذ
            </button>
          </div>
        </div>
      </section>

      {prices && (
        <section className="overflow-x-auto rounded-xl border border-border bg-card">
          <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
            أسعار المودلات (دولار لكل مليون توكن)
          </h3>
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-right text-[11px] text-muted-foreground">
                <th className="px-4 py-2">المودل</th>
                <th className="px-2 py-2">إدخال</th>
                <th className="px-2 py-2">إخراج</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {prices.map((row, i) => (
                <tr key={`${row.provider}/${row.model}`} className="border-b border-border/40">
                  <td className="px-4 py-2 text-foreground">
                    {row.provider}/{row.model}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.input_usd_per_m}
                      onChange={(e) =>
                        setPrices((prev) =>
                          prev!.map((p, j) =>
                            j === i ? { ...p, input_usd_per_m: Number(e.target.value) } : p,
                          ),
                        )
                      }
                      className="w-20 rounded border border-border bg-background px-1 py-0.5"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={row.output_usd_per_m}
                      onChange={(e) =>
                        setPrices((prev) =>
                          prev!.map((p, j) =>
                            j === i ? { ...p, output_usd_per_m: Number(e.target.value) } : p,
                          ),
                        )
                      }
                      className="w-20 rounded border border-border bg-background px-1 py-0.5"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button
                      onClick={() => savePrice(row)}
                      className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      حفظ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
