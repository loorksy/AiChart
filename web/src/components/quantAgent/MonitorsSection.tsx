"use client";

/**
 * Quant Agent Chat's "AI Scheduled Monitors" section (plan §A7) — list of a
 * user's monitors plus a create-monitor sheet (symbol prefilled from the
 * chat's active symbol, interval select, per-channel notify checkboxes).
 * Backed by `/api/quant-agent/monitors`.
 */
import { useCallback, useEffect, useState } from "react";
import { Bell, Plus, Radio, Send, Trash2, Webhook } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { EmptyState } from "@/components/foundation";
import { PairFlags } from "@/components/agent/CurrencyFlag";
import { Button } from "@/components/squareui/button";
import { Checkbox } from "@/components/squareui/checkbox";
import { Input } from "@/components/squareui/input";
import { Label } from "@/components/squareui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/squareui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/squareui/sheet";
import { cn } from "@/lib/utils";

interface Monitor {
  id: number;
  symbol: string;
  market: string;
  interval: string;
  notifyTelegram: boolean;
  notifyPush: boolean;
  notifyWebhookUrl: string | null;
  enabled: boolean;
  fireRule: MonitorFireRule;
  lastFiredRecommendationId: string | null;
  lastFiredDecision: string | null;
  lastCheckedAt: number | null;
}

/** Deliberately shorter than the full chart interval list — a monitor's
 * cadence is also its re-check cost, so only sane scan intervals are offered. */
const MONITOR_INTERVALS = ["5m", "15m", "30m", "1h", "4h", "1d"] as const;

/**
 * How often a monitor is allowed to speak. `always` is the default and the
 * pre-existing behaviour, so an untouched monitor keeps saying exactly what it
 * said before; `on_change` is for the user watching a slow timeframe, for whom
 * the second identical SELL is not news, it is the same news again.
 */
const MONITOR_FIRE_RULE_OPTIONS = ["always", "on_change"] as const;
type MonitorFireRule = (typeof MONITOR_FIRE_RULE_OPTIONS)[number];

export function MonitorsSection({ activeSymbol }: { activeSymbol: string }) {
  const { t } = useLocale();
  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState(activeSymbol);
  // Named to avoid shadowing the global `setInterval` timer function.
  const [intervalValue, setIntervalValue] = useState<string>("1h");
  const [notifyTelegram, setNotifyTelegram] = useState(true);
  const [notifyPush, setNotifyPush] = useState(false);
  const [fireRule, setFireRule] = useState<MonitorFireRule>("always");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/quant-agent/monitors", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const json = (await res.json()) as { monitors?: Monitor[] };
      setMonitors(json.monitors ?? []);
    } catch {
      setMonitors((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setSymbol(activeSymbol);
    setIntervalValue("1h");
    setNotifyTelegram(true);
    setNotifyPush(false);
    setFireRule("always");
    setWebhookUrl("");
    setError(null);
    setOpen(true);
  }

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/quant-agent/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          interval: intervalValue,
          notifyTelegram,
          notifyPush,
          fireRule,
          notifyWebhookUrl: webhookUrl.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? t("qa.monitors.create_error"));
        return;
      }
      setOpen(false);
      await load();
    } catch {
      setError(t("qa.monitors.create_error"));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleEnabled(monitor: Monitor) {
    setBusyId(monitor.id);
    setMonitors((prev) =>
      (prev ?? []).map((m) => (m.id === monitor.id ? { ...m, enabled: !m.enabled } : m)),
    );
    try {
      await fetch(`/api/quant-agent/monitors/${monitor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !monitor.enabled }),
      });
    } catch {
      void load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: number) {
    setBusyId(id);
    setMonitors((prev) => (prev ?? []).filter((m) => m.id !== id));
    try {
      await fetch(`/api/quant-agent/monitors/${id}`, { method: "DELETE" });
    } catch {
      void load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{t("qa.monitors.title")}</span>
        <button
          type="button"
          onClick={openCreate}
          aria-label={t("qa.monitors.create")}
          title={t("qa.monitors.create")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground">{t("qa.monitors.live_price_note")}</p>

      {monitors == null ? (
        <div className="py-4 text-center text-xs text-muted-foreground">{t("qa.monitors.loading")}</div>
      ) : monitors.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Bell aria-hidden="true" />}
          title={t("qa.monitors.empty.title")}
          description={t("qa.monitors.empty.description")}
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {monitors.map((monitor) => (
            <li key={monitor.id} className="rounded-lg bg-muted/50 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <PairFlags symbol={monitor.symbol} size={16} />
                  <span dir="ltr" className="truncate text-xs font-medium text-foreground">
                    {monitor.symbol}
                  </span>
                  <span
                    dir="ltr"
                    className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {monitor.interval}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void toggleEnabled(monitor)}
                    disabled={busyId === monitor.id}
                    aria-pressed={monitor.enabled}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                      monitor.enabled
                        ? "border-buy/45 bg-buy/10 text-buy"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {monitor.enabled ? t("qa.monitors.enabled") : t("qa.monitors.disabled")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(monitor.id)}
                    disabled={busyId === monitor.id}
                    aria-label={t("qa.monitors.delete")}
                    title={t("qa.monitors.delete")}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {monitor.notifyTelegram ||
              monitor.notifyPush ||
              monitor.notifyWebhookUrl ||
              monitor.fireRule === "on_change" ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {/* Only the non-default rule is shown: a badge on every row
                      saying "any signal" is noise that trains the eye to skip
                      the row where it actually differs. */}
                  {monitor.fireRule === "on_change" ? (
                    <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t("qa.monitors.fire_rule.on_change")}
                    </span>
                  ) : null}
                  {monitor.notifyTelegram ? (
                    <span className="flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-1.5 py-0.5 text-[10px] text-info">
                      <Send className="h-2.5 w-2.5" aria-hidden="true" />
                      {t("qa.monitors.channel.telegram")}
                    </span>
                  ) : null}
                  {monitor.notifyPush ? (
                    <span className="flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-1.5 py-0.5 text-[10px] text-info">
                      <Radio className="h-2.5 w-2.5" aria-hidden="true" />
                      {t("qa.monitors.channel.push")}
                    </span>
                  ) : null}
                  {monitor.notifyWebhookUrl ? (
                    <span className="flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-1.5 py-0.5 text-[10px] text-info">
                      <Webhook className="h-2.5 w-2.5" aria-hidden="true" />
                      {t("qa.monitors.channel.webhook")}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("qa.monitors.create")}</SheetTitle>
            <SheetDescription>{t("qa.monitors.create_description")}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qa-monitor-symbol">{t("qa.monitors.field.symbol")}</Label>
              <Input
                id="qa-monitor-symbol"
                dir="ltr"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                maxLength={32}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qa-monitor-interval">{t("qa.monitors.field.interval")}</Label>
              <Select
                value={intervalValue}
                onValueChange={(value) => {
                  if (value) setIntervalValue(value);
                }}
              >
                <SelectTrigger id="qa-monitor-interval" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONITOR_INTERVALS.map((iv) => (
                    <SelectItem key={iv} value={iv}>
                      <span dir="ltr">{iv}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qa-monitor-fire-rule">{t("qa.monitors.field.fire_rule")}</Label>
              <Select
                value={fireRule}
                onValueChange={(value) => {
                  if (value) setFireRule(value as MonitorFireRule);
                }}
              >
                <SelectTrigger id="qa-monitor-fire-rule" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONITOR_FIRE_RULE_OPTIONS.map((rule) => (
                    <SelectItem key={rule} value={rule}>
                      {t(`qa.monitors.fire_rule.${rule}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>{t("qa.monitors.field.channels")}</Label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox checked={notifyTelegram} onCheckedChange={setNotifyTelegram} />
                {t("qa.monitors.channel.telegram")}
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox checked={notifyPush} onCheckedChange={setNotifyPush} />
                {t("qa.monitors.channel.push")}
              </label>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qa-monitor-webhook">{t("qa.monitors.channel.webhook")}</Label>
                <Input
                  id="qa-monitor-webhook"
                  dir="ltr"
                  placeholder="https://…"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  maxLength={2048}
                />
              </div>
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
          <SheetFooter>
            <Button type="button" onClick={() => void handleCreate()} disabled={submitting || !symbol.trim()}>
              {submitting ? t("qa.monitors.creating") : t("qa.monitors.create_submit")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
