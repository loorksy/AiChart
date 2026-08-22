"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard } from "lucide-react";

import { useLocale } from "@/hooks/useLocale";
import { Badge } from "@/components/squareui/badge";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";
import {
  AdminCard,
  AdminCardBody,
  AdminCardHeader,
  AdminPage,
  Field,
  InlineAlert,
  SectionHeader,
  Td,
  Th,
  THead,
  TableEmptyRow,
  TableWrap,
  Tr,
} from "@/components/admin/ui/AdminKit";

interface PlanRow {
  trial_recommendations: number;
  trial_duration_minutes: number;
  low_balance_threshold: number;
  expiry_warn_days: number;
}

interface PriceRow {
  id: number;
  price_cents: number;
  credits_per_cycle: number;
  cycle_days: number;
  archived_at: number | null;
}

interface PackRow {
  id: number;
  credits: number;
  price_cents: number;
  active: number;
  sort: number;
  archived_at: number | null;
}

interface OfferRow {
  id: number;
  kind: "percent" | "fixed_cents";
  value: number;
  starts_at: number;
  ends_at: number;
  active: number;
}

interface ConfigData {
  ok: boolean;
  plan: PlanRow;
  current_price: PriceRow | null;
  credit_prices: Record<string, number>;
  packs: PackRow[];
  offers: OfferRow[];
  payments_configured: boolean;
}

const OP_LABEL_KEYS: Record<string, string> = {
  recommendation: "admin.billing.op_recommendation",
  chat_turn: "admin.billing.op_chat",
  mt5_link: "admin.billing.op_mt5",
};

/**
 * Billing v3 admin configuration — every priced or bounded number the
 * platform enforces lives HERE as data. Publishing a price creates a NEW
 * immutable row (subscribers keep the row they bought); the calculator is
 * display-only and writes nothing.
 */
export function AdminBillingConfigPanel() {
  const { t } = useLocale();
  const [data, setData] = useState<ConfigData | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [newPrice, setNewPrice] = useState({ usd: "", credits: "", days: "30" });
  const [newPack, setNewPack] = useState({ credits: "", usd: "" });
  const [newOffer, setNewOffer] = useState({
    kind: "percent" as "percent" | "fixed_cents",
    value: "",
    starts: "",
    ends: "",
  });

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/admin/billing/config");
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as ConfigData;
      setData(d);
      setPlan(d.plan);
      setPrices(d.credit_prices);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(path: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !out?.ok) {
        setMessage(out?.error ?? t("admin.billing.request_failed", { status: String(res.status) }));
        return false;
      }
      await load();
      setMessage(t("admin.billing.saved"));
      return true;
    } finally {
      setBusy(false);
    }
  }

  // The display-only calculator: value per credit and recommendations per
  // cycle from the typed numbers. Nothing writes without an explicit save.
  const calc = useMemo(() => {
    const priceUsd = Number(newPrice.usd) || (data?.current_price?.price_cents ?? 0) / 100;
    const credits = Number(newPrice.credits) || data?.current_price?.credits_per_cycle || 0;
    const recPrice = prices.recommendation ?? 0;
    if (!priceUsd || !credits) return null;
    const perCredit = priceUsd / credits;
    const recs = recPrice > 0 ? Math.floor(credits / recPrice) : null;
    return {
      perCredit: perCredit.toFixed(4),
      recs,
      recCostUsd: recPrice > 0 ? (perCredit * recPrice).toFixed(2) : null,
    };
  }, [newPrice, prices, data]);

  if (!data || !plan) {
    return failed ? (
      <AdminPage>
        <InlineAlert tone="error">{t("admin.billing.load_failed")}</InlineAlert>
        <Button onClick={() => void load()}>{t("billing.retry")}</Button>
      </AdminPage>
    ) : (
      <AdminPage>
        <CardSkeleton lines={6} />
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <SectionHeader
        title={t("admin.billing.title")}
        description={t("admin.billing.subtitle")}
        icon={CreditCard}
      />
      {message && <InlineAlert tone="info">{message}</InlineAlert>}
      <div className="flex items-center gap-2">
        <Badge variant={data.payments_configured ? "default" : "outline"}>
          {data.payments_configured ? t("admin.billing.stripe_on") : t("admin.billing.stripe_off")}
        </Badge>
        {!data.payments_configured && (
          <span className="text-xs text-muted-foreground">{t("admin.billing.stripe_hint")}</span>
        )}
      </div>

      <AdminCard>
        <AdminCardHeader title={t("admin.billing.current_price")} />
        <AdminCardBody>
          {data.current_price ? (
            <p className="text-sm text-foreground" dir="ltr">
              ${(data.current_price.price_cents / 100).toFixed(2)} /{" "}
              {data.current_price.cycle_days}d → {data.current_price.credits_per_cycle} credits
              <span className="ms-2 text-xs text-muted-foreground">
                (row #{data.current_price.id})
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("admin.billing.no_price")}</p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <Field htmlFor="bcfg-price-usd" label={t("admin.billing.price_usd")}>
              <Input
                id="bcfg-price-usd"
                inputMode="decimal"
                value={newPrice.usd}
                onChange={(e) => setNewPrice((p) => ({ ...p, usd: e.target.value }))}
                placeholder="180"
              />
            </Field>
            <Field htmlFor="bcfg-price-credits" label={t("admin.billing.credits_per_cycle")}>
              <Input
                id="bcfg-price-credits"
                inputMode="numeric"
                value={newPrice.credits}
                onChange={(e) => setNewPrice((p) => ({ ...p, credits: e.target.value }))}
                placeholder="1200"
              />
            </Field>
            <Field htmlFor="bcfg-price-days" label={t("admin.billing.cycle_days")}>
              <Input
                id="bcfg-price-days"
                inputMode="numeric"
                value={newPrice.days}
                onChange={(e) => setNewPrice((p) => ({ ...p, days: e.target.value }))}
              />
            </Field>
            <div className="flex items-end">
              <Button
                disabled={busy || !newPrice.usd || !newPrice.credits}
                onClick={() =>
                  void call("/api/admin/billing/config", "POST", {
                    price_cents: Math.round(Number(newPrice.usd) * 100),
                    credits_per_cycle: Number(newPrice.credits),
                    cycle_days: Number(newPrice.days) || 30,
                  })
                }
              >
                {t("admin.billing.publish_price")}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("admin.billing.price_immutable_note")}
          </p>
        </AdminCardBody>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader title={t("admin.billing.op_prices")} />
        <AdminCardBody>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.keys(OP_LABEL_KEYS).map((op) => (
              <Field key={op} htmlFor={`bcfg-op-${op}`} label={t(OP_LABEL_KEYS[op]!)}>
                <Input
                  id={`bcfg-op-${op}`}
                  inputMode="numeric"
                  value={String(prices[op] ?? 0)}
                  onChange={(e) =>
                    setPrices((p) => ({ ...p, [op]: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("admin.billing.zero_free")}</p>
          <Button
            className="mt-3"
            disabled={busy}
            onClick={() =>
              void call("/api/admin/billing/config", "PUT", { credit_prices: prices })
            }
          >
            {t("admin.billing.save_op_prices")}
          </Button>
        </AdminCardBody>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader title={t("admin.billing.trial_alerts")} />
        <AdminCardBody>
          <div className="grid gap-2 sm:grid-cols-4">
            <Field htmlFor="bcfg-trial-recs" label={t("admin.billing.trial_recs")}>
              <Input
                id="bcfg-trial-recs"
                inputMode="numeric"
                value={String(plan.trial_recommendations)}
                onChange={(e) =>
                  setPlan((p) => p && { ...p, trial_recommendations: Number(e.target.value) || 0 })
                }
              />
            </Field>
            <Field htmlFor="bcfg-trial-clock" label={t("admin.billing.trial_clock")}>
              <Input
                id="bcfg-trial-clock"
                inputMode="numeric"
                value={String(plan.trial_duration_minutes)}
                onChange={(e) =>
                  setPlan((p) => p && { ...p, trial_duration_minutes: Number(e.target.value) || 0 })
                }
              />
            </Field>
            <Field htmlFor="bcfg-low" label={t("admin.billing.low_threshold")}>
              <Input
                id="bcfg-low"
                inputMode="numeric"
                value={String(plan.low_balance_threshold)}
                onChange={(e) =>
                  setPlan((p) => p && { ...p, low_balance_threshold: Number(e.target.value) || 0 })
                }
              />
            </Field>
            <Field htmlFor="bcfg-warn" label={t("admin.billing.expiry_warn")}>
              <Input
                id="bcfg-warn"
                inputMode="numeric"
                value={String(plan.expiry_warn_days)}
                onChange={(e) =>
                  setPlan((p) => p && { ...p, expiry_warn_days: Number(e.target.value) || 0 })
                }
              />
            </Field>
          </div>
          <Button
            className="mt-3"
            disabled={busy}
            onClick={() =>
              void call("/api/admin/billing/config", "PUT", {
                trial_recommendations: plan.trial_recommendations,
                trial_duration_minutes: plan.trial_duration_minutes,
                low_balance_threshold: plan.low_balance_threshold,
                expiry_warn_days: plan.expiry_warn_days,
              })
            }
          >
            {t("admin.billing.save_trial")}
          </Button>
        </AdminCardBody>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader title={t("admin.billing.calculator")} />
        <AdminCardBody>
          {calc ? (
            <ul className="space-y-1 text-sm text-foreground">
              <li dir="ltr">1 credit ≈ ${calc.perCredit}</li>
              {calc.recs != null && (
                <li>
                  {t("admin.billing.calc_recs", { count: String(calc.recs) })}
                  {calc.recCostUsd && (
                    <span dir="ltr" className="text-muted-foreground">
                      {" "}
                      (≈ ${calc.recCostUsd})
                    </span>
                  )}
                </li>
              )}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("admin.billing.calc_hint")}</p>
          )}
        </AdminCardBody>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader title={t("admin.billing.packs")} />
        <AdminCardBody>
          <TableWrap>
            <table className="w-full text-sm">
              <THead>
                <Tr>
                  <Th>{t("admin.billing.credits")}</Th>
                  <Th>{t("admin.billing.price_usd")}</Th>
                  <Th>{t("admin.billing.state")}</Th>
                  <Th>{t("admin.billing.action")}</Th>
                </Tr>
              </THead>
              <tbody>
                {data.packs.length === 0 && (
                  <TableEmptyRow colSpan={4} title={t("admin.billing.no_packs")} />
                )}
                {data.packs.map((pack) => (
                  <Tr key={pack.id}>
                    <Td numeric dir="ltr">{pack.credits}</Td>
                    <Td numeric dir="ltr">${(pack.price_cents / 100).toFixed(2)}</Td>
                    <Td>
                      <Badge
                        variant={
                          pack.archived_at ? "outline" : pack.active ? "default" : "secondary"
                        }
                      >
                        {pack.archived_at
                          ? t("admin.billing.archived")
                          : pack.active
                            ? t("admin.billing.active")
                            : t("admin.billing.paused")}
                      </Badge>
                    </Td>
                    <Td>
                      {!pack.archived_at && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void call("/api/admin/billing/packs", "PATCH", {
                                id: pack.id,
                                active: !pack.active,
                              })
                            }
                          >
                            {pack.active ? t("admin.billing.pause") : t("admin.billing.enable")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void call("/api/admin/billing/packs", "PATCH", {
                                id: pack.id,
                                archive: true,
                              })
                            }
                          >
                            {t("admin.billing.archive")}
                          </Button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Field htmlFor="bcfg-pack-credits" label={t("admin.billing.credits")}>
              <Input
                id="bcfg-pack-credits"
                inputMode="numeric"
                value={newPack.credits}
                onChange={(e) => setNewPack((p) => ({ ...p, credits: e.target.value }))}
                placeholder="500"
              />
            </Field>
            <Field htmlFor="bcfg-pack-usd" label={t("admin.billing.price_usd")}>
              <Input
                id="bcfg-pack-usd"
                inputMode="decimal"
                value={newPack.usd}
                onChange={(e) => setNewPack((p) => ({ ...p, usd: e.target.value }))}
                placeholder="49"
              />
            </Field>
            <div className="flex items-end">
              <Button
                disabled={busy || !newPack.credits || !newPack.usd}
                onClick={() =>
                  void call("/api/admin/billing/packs", "POST", {
                    credits: Number(newPack.credits),
                    price_cents: Math.round(Number(newPack.usd) * 100),
                  })
                }
              >
                {t("admin.billing.add_pack")}
              </Button>
            </div>
          </div>
        </AdminCardBody>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader title={t("admin.billing.offers")} />
        <AdminCardBody>
          <TableWrap>
            <table className="w-full text-sm">
              <THead>
                <Tr>
                  <Th>{t("admin.billing.kind")}</Th>
                  <Th>{t("admin.billing.value")}</Th>
                  <Th>{t("admin.billing.from")}</Th>
                  <Th>{t("admin.billing.to")}</Th>
                  <Th>{t("admin.billing.state")}</Th>
                  <Th>{t("admin.billing.action")}</Th>
                </Tr>
              </THead>
              <tbody>
                {data.offers.length === 0 && (
                  <TableEmptyRow colSpan={6} title={t("admin.billing.no_offers")} />
                )}
                {data.offers.map((offer) => {
                  const now = Date.now();
                  const live = offer.active && offer.starts_at <= now && offer.ends_at > now;
                  return (
                    <Tr key={offer.id}>
                      <Td>
                        {offer.kind === "percent"
                          ? t("admin.billing.percent")
                          : t("admin.billing.amount")}
                      </Td>
                      <Td numeric dir="ltr">
                        {offer.kind === "percent"
                          ? `${offer.value}%`
                          : `$${(offer.value / 100).toFixed(2)}`}
                      </Td>
                      <Td dir="ltr">{new Date(offer.starts_at).toLocaleDateString()}</Td>
                      <Td dir="ltr">{new Date(offer.ends_at).toLocaleDateString()}</Td>
                      <Td>
                        <Badge variant={live ? "default" : "outline"}>
                          {live
                            ? t("admin.billing.live")
                            : offer.active
                              ? t("admin.billing.out_of_window")
                              : t("admin.billing.disabled")}
                        </Badge>
                      </Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void call("/api/admin/billing/offers", "PATCH", {
                              id: offer.id,
                              active: !offer.active,
                            })
                          }
                        >
                          {offer.active
                            ? t("admin.billing.disable_now")
                            : t("admin.billing.enable")}
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-2 text-xs text-muted-foreground">{t("admin.billing.offer_note")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-5">
            <Field htmlFor="bcfg-offer-kind" label={t("admin.billing.kind")}>
              <select
                id="bcfg-offer-kind"
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={newOffer.kind}
                onChange={(e) =>
                  setNewOffer((o) => ({
                    ...o,
                    kind: e.target.value as "percent" | "fixed_cents",
                  }))
                }
              >
                <option value="percent">{t("admin.billing.percent")}</option>
                <option value="fixed_cents">{t("admin.billing.amount_cents")}</option>
              </select>
            </Field>
            <Field htmlFor="bcfg-offer-value" label={t("admin.billing.value")}>
              <Input
                id="bcfg-offer-value"
                inputMode="numeric"
                value={newOffer.value}
                onChange={(e) => setNewOffer((o) => ({ ...o, value: e.target.value }))}
                placeholder="20"
              />
            </Field>
            <Field htmlFor="bcfg-offer-starts" label={t("admin.billing.starts")}>
              <Input
                id="bcfg-offer-starts"
                type="date"
                value={newOffer.starts}
                onChange={(e) => setNewOffer((o) => ({ ...o, starts: e.target.value }))}
              />
            </Field>
            <Field htmlFor="bcfg-offer-ends" label={t("admin.billing.ends")}>
              <Input
                id="bcfg-offer-ends"
                type="date"
                value={newOffer.ends}
                onChange={(e) => setNewOffer((o) => ({ ...o, ends: e.target.value }))}
              />
            </Field>
            <div className="flex items-end">
              <Button
                disabled={busy || !newOffer.value || !newOffer.starts || !newOffer.ends}
                onClick={() =>
                  void call("/api/admin/billing/offers", "POST", {
                    kind: newOffer.kind,
                    value: Number(newOffer.value),
                    starts_at: new Date(newOffer.starts).getTime(),
                    ends_at: new Date(newOffer.ends).getTime(),
                  })
                }
              >
                {t("admin.billing.create_offer")}
              </Button>
            </div>
          </div>
        </AdminCardBody>
      </AdminCard>
    </AdminPage>
  );
}
