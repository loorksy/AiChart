"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Grid3X3,
  Play,
  Square,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Wifi,
  WifiOff,
  Wallet,
  Sparkles,
} from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { SurfaceCard } from "@/components/ui/shell";
import { StatusChip, type StatusChipTone } from "@/components/bridge/StatusChip";
import { breakEven } from "@/lib/strategies/gridBot";
import { PATTERN_LABELS } from "@/lib/strategies/gold/candlePatterns";
import type { GoldEntryPattern } from "@/lib/strategies/gold/goldTypes";
import { cn } from "@/lib/utils";
import type { BotBrokerSymbol, BotsMetaResponse } from "@/lib/botsMetaTypes";
import { pickDefaultSymbol } from "@/lib/botsMetaTypes";
import {
  DEFAULT_GRID_FORM,
  GridBotForm,
  type BotMarket,
  type BotSide,
  type ExecutionMode,
  type GridFormState,
} from "@/components/bots/GridBotForm";
import {
  DEFAULT_GOLD_FORM,
  GoldBotForm,
  type GoldFormState,
} from "@/components/bots/GoldBotForm";

type BotStatus = "active" | "stopped";
type BotType = "grid" | "gold";

interface GridLevel {
  price: number;
  lot: number;
}

interface BotSession {
  id: number;
  strategy: string;
  symbol: string;
  market: string;
  side: BotSide;
  config: Record<string, unknown>;
  state: {
    levels: GridLevel[];
    entrySide?: BotSide;
    detectedPattern?: GoldEntryPattern;
  };
  status: BotStatus;
  executionMode: ExecutionMode;
  realizedPnl: number;
  stopReason: string | null;
}

interface BotsResponse {
  bots: BotSession[];
  meta?: { liveEnabled: boolean };
}

const META_POLL_MS = 12_000;

function formatMoney(value: number | null, currency: string | null): string {
  if (value == null) return "—";
  const cur = currency ?? "";
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ""}`;
}

function ConnectionCard({
  title,
  chip,
  detail,
  icon: Icon,
}: {
  title: string;
  chip: { label: string; tone: StatusChipTone };
  detail?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/15 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/40">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </span>
        <StatusChip label={chip.label} tone={chip.tone} />
      </div>
      <p className="mt-2 text-xs font-medium">{title}</p>
      {detail && (
        <p className="mt-0.5 text-[10px] text-muted-foreground" dir="ltr">
          {detail}
        </p>
      )}
    </div>
  );
}

function BrokerStatusPanel({ meta }: { meta: BotsMetaResponse }) {
  const { forex, binance } = meta;
  const eaBridge = forex.eaBridge;

  const forexChip = !forex.connected
    ? { label: "غير مرتبط", tone: "neutral" as StatusChipTone }
    : forex.online
      ? { label: "متصل", tone: "ok" as StatusChipTone }
      : { label: "غير متصل", tone: "error" as StatusChipTone };

  const eaChip = !eaBridge?.connected
    ? { label: "غير مربوط", tone: "neutral" as StatusChipTone }
    : eaBridge.online
      ? { label: "متصل", tone: "ok" as StatusChipTone }
      : { label: "غير متصل", tone: "error" as StatusChipTone };

  const binanceChip = !binance.connected
    ? { label: "غير مرتبط", tone: "neutral" as StatusChipTone }
    : binance.online
      ? binance.accountEnv === "live"
        ? { label: "حقيقي", tone: "ok" as StatusChipTone }
        : { label: "تجريبي", tone: "warn" as StatusChipTone }
      : { label: "غير متصل", tone: "error" as StatusChipTone };

  const forexDetail = forex.connected
    ? [forex.backendLabel, forex.broker, forex.login ? `#${forex.login}` : null]
        .filter(Boolean)
        .join(" · ")
    : "قناة تنفيذ البوت — اربط من الإعدادات";

  const eaDetail = eaBridge
    ? [
        eaBridge.platform?.toUpperCase(),
        eaBridge.broker,
        eaBridge.login ? `#${eaBridge.login}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  const binanceDetail = binance.connected
    ? binance.env === "prod"
      ? "Binance · حساب حقيقي"
      : "Binance · testnet"
    : "اربط مفاتيح API";

  return (
    <SurfaceCard>
      <h2 className="text-sm font-semibold">حالة الاتصال بالوسيط</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        البوت ينفّذ عبر الوسيط المرتبط — تأكّد أن القناة نشطة قبل التشغيل
        الحقيقي.
      </p>
      {forex.channelNote && (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
          {forex.channelNote}{" "}
          <Link href="/console/connect" className="underline hover:text-amber-100">
            تغيير طريقة الربط
          </Link>
        </p>
      )}
      <div
        className={cn(
          "mt-3 grid gap-3",
          eaBridge ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2",
        )}
      >
        <ConnectionCard
          title={`تنفيذ البوت · ${forex.backendLabel}`}
          chip={forexChip}
          detail={forexDetail}
          icon={forex.online ? Wifi : WifiOff}
        />
        {eaBridge && (
          <ConnectionCard
            title="جسر EA · MetaTrader"
            chip={eaChip}
            detail={eaDetail}
            icon={eaBridge.online ? Wifi : WifiOff}
          />
        )}
        <ConnectionCard
          title="Binance · كريبتو"
          chip={binanceChip}
          detail={binanceDetail}
          icon={TrendingUp}
        />
      </div>
    </SurfaceCard>
  );
}

function AccountBalanceBar({
  meta,
  market,
}: {
  meta: BotsMetaResponse;
  market: BotMarket;
}) {
  const acct = market === "forex" ? meta.forex : meta.binance;
  const envLabel = acct.accountEnvLabel;
  const envTone: StatusChipTone =
    acct.accountEnv === "live"
      ? "ok"
      : acct.accountEnv === "demo"
        ? "warn"
        : "neutral";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/10 px-4 py-3">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-xs text-muted-foreground">
            رصيد الحساب ({market === "forex" ? "فوركس" : "كريبتو"})
          </p>
          <p className="font-semibold" dir="ltr">
            {formatMoney(acct.balance, acct.currency)}
            {acct.equity != null &&
              acct.equity !== acct.balance &&
              acct.equity > 0 && (
                <span className="ms-2 text-xs font-normal text-muted-foreground">
                  equity {formatMoney(acct.equity, acct.currency)}
                </span>
              )}
          </p>
        </div>
      </div>
      <StatusChip label={envLabel} tone={envTone} />
    </div>
  );
}

function totalLot(levels: GridLevel[]): number {
  return levels.reduce((s, l) => s + l.lot, 0);
}

function BotCard({
  bot,
  busy,
  onStop,
}: {
  bot: BotSession;
  busy: boolean;
  onStop: (id: number) => void;
}) {
  const isGold = bot.strategy === "gold";
  const levels = bot.state.levels;
  const be = levels.length ? breakEven(levels) : 0;
  const lotSum = totalLot(levels);
  const active = bot.status === "active";
  const side = bot.state.entrySide ?? bot.side;
  const pattern = bot.state.detectedPattern;

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        active
          ? isGold
            ? "border-yellow-500/25 bg-yellow-500/5"
            : "border-emerald-500/25 bg-emerald-500/5"
          : "border-border bg-muted/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold" dir="ltr">
              {bot.symbol}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                isGold
                  ? "bg-yellow-500/15 text-yellow-400"
                  : "bg-blue-500/15 text-blue-400",
              )}
            >
              {isGold ? "ذهب" : "شبكة"}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                side === "sell"
                  ? "bg-rose-500/15 text-rose-400"
                  : "bg-emerald-500/15 text-emerald-400",
              )}
            >
              {side === "sell" ? "بيع" : "شراء"}
            </span>
            {!isGold && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {bot.market === "forex" ? "فوركس" : "كريبتو"}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isGold ? "ذهب · price action" : "شبكة"} ·{" "}
            {bot.executionMode === "live" ? "حقيقي" : "تجريبي"} · #{bot.id}
          </p>
          {isGold && pattern && (
            <p className="mt-1 text-xs text-yellow-400/90">
              نمط الدخول: {PATTERN_LABELS[pattern] ?? pattern}
            </p>
          )}
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            active
              ? "bg-emerald-500/15 text-emerald-500"
              : "bg-muted text-muted-foreground",
          )}
        >
          {active ? "نشط" : "متوقف"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">مستويات</p>
          <p className="font-medium">
            {levels.length} /{" "}
            {typeof bot.config.maxLevels === "number"
              ? bot.config.maxLevels
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">إجمالي اللوت</p>
          <p className="font-medium" dir="ltr">
            {lotSum.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">تعادل</p>
          <p className="font-medium" dir="ltr">
            {be > 0 ? be.toFixed(2) : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">ربح محقّق</p>
          <p
            className={cn(
              "font-semibold",
              bot.realizedPnl >= 0 ? "text-emerald-500" : "text-rose-500",
            )}
            dir="ltr"
          >
            {bot.realizedPnl >= 0 ? "+" : ""}
            {bot.realizedPnl.toFixed(2)}
          </p>
        </div>
      </div>

      {levels.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[240px] text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-1 text-start font-medium">#</th>
                <th className="pb-1 text-start font-medium">سعر</th>
                <th className="pb-1 text-start font-medium">لوت</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((lv, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="py-1">{i + 1}</td>
                  <td className="py-1" dir="ltr">
                    {lv.price.toFixed(2)}
                  </td>
                  <td className="py-1" dir="ltr">
                    {lv.lot.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bot.stopReason && !active && (
        <p className="mt-2 text-xs text-muted-foreground">
          سبب الإيقاف: {bot.stopReason}
        </p>
      )}

      {active && (
        <button
          type="button"
          onClick={() => onStop(bot.id)}
          disabled={busy}
          className="btn btn-danger mt-3 flex w-full items-center justify-center gap-2 text-sm"
        >
          <Square className="h-4 w-4" />
          إيقاف البوت
        </button>
      )}
    </div>
  );
}

export function BotsClient() {
  const [bots, setBots] = useState<BotSession[]>([]);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [meta, setMeta] = useState<BotsMetaResponse | null>(null);
  const [gridForm, setGridForm] = useState<GridFormState>(DEFAULT_GRID_FORM);
  const [goldForm, setGoldForm] = useState<GoldFormState>(DEFAULT_GOLD_FORM);
  const [botType, setBotType] = useState<BotType>("grid");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );

  const formMarket: BotMarket =
    botType === "gold" ? "forex" : gridForm.market;

  const refreshMeta = useCallback(async (market: BotMarket) => {
    try {
      const r = await fetch(`/api/bots/meta?market=${market}`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const d = (await r.json()) as BotsMetaResponse;
      setMeta(d);
      setLiveEnabled(Boolean(d.liveEnabled));
      return d;
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/bots", { cache: "no-store" });
      if (!r.ok) return;
      const d: BotsResponse = await r.json();
      setBots(d.bots ?? []);
      if (d.meta?.liveEnabled != null) setLiveEnabled(Boolean(d.meta.liveEnabled));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshMeta(formMarket);
  }, [refresh, refreshMeta, formMarket]);

  useEffect(() => {
    const id = setInterval(() => {
      void refreshMeta(formMarket);
    }, META_POLL_MS);
    return () => clearInterval(id);
  }, [refreshMeta, formMarket]);

  const handleSymbolsLoaded = useCallback((list: BotBrokerSymbol[]) => {
    if (list.length === 0) return;
    setGridForm((f) => {
      const current = f.symbol.trim().toUpperCase();
      const exists = list.some((s) => s.symbol.toUpperCase() === current);
      if (exists && current) return f;
      return { ...f, symbol: pickDefaultSymbol(f.market, list) };
    });
  }, []);

  const brokerConnected =
    formMarket === "forex"
      ? Boolean(meta?.forex.connected)
      : Boolean(meta?.binance.connected);

  const hasActive = useMemo(
    () => bots.some((b) => b.status === "active"),
    [bots],
  );

  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [hasActive, refresh]);

  async function createGridBot() {
    setBusy(true);
    setMsg(null);
    try {
      const symbol = gridForm.symbol.trim().toUpperCase();
      if (!symbol) {
        setMsg({ type: "err", text: "اختر رمزاً من قائمة الوسيط." });
        return;
      }
      const r = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: "grid",
          symbol,
          market: gridForm.market,
          side: gridForm.side,
          executionMode: gridForm.executionMode,
          config: {
            initialLot: gridForm.initialLot,
            gridStep: gridForm.gridStep,
            multiplier: gridForm.multiplier,
            takeProfit: gridForm.takeProfit,
            maxLevels: gridForm.maxLevels,
            maxTotalLot: gridForm.maxTotalLot,
          },
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ type: "err", text: d.error ?? "تعذّر إنشاء البوت." });
        return;
      }
      setMsg({ type: "ok", text: "تم تشغيل بوت الشبكة — يعمل على السيرفر 24/7." });
      setShowForm(false);
      setGridForm(DEFAULT_GRID_FORM);
      await refresh();
    } catch {
      setMsg({ type: "err", text: "خطأ في الاتصال." });
    } finally {
      setBusy(false);
    }
  }

  async function createGoldBot() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: "gold",
          market: "forex",
          executionMode: goldForm.executionMode,
          config: {
            initialLot: goldForm.initialLot,
            gridStepPips: goldForm.gridStepPips,
            takeProfitPips: goldForm.takeProfitPips,
            multiplier: goldForm.multiplier,
            maxLevels: goldForm.maxLevels,
            maxTotalLot: goldForm.maxTotalLot,
            maxLotCap: goldForm.maxLotCap,
            candleTimeframe: goldForm.candleTimeframe,
            maxEquityDrawdownPct: goldForm.maxEquityDrawdownPct,
          },
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ type: "err", text: d.error ?? "تعذّر إنشاء البوت." });
        return;
      }
      setMsg({ type: "ok", text: "تم تشغيل بوت الذهب — دخول تلقائي من الشموع." });
      setShowForm(false);
      setGoldForm(DEFAULT_GOLD_FORM);
      await refresh();
    } catch {
      setMsg({ type: "err", text: "خطأ في الاتصال." });
    } finally {
      setBusy(false);
    }
  }

  async function stopBot(id: number) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/bots/${id}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ type: "err", text: d.error ?? "تعذّر الإيقاف." });
        return;
      }
      setMsg({ type: "ok", text: "تم إيقاف البوت." });
      await refresh();
    } catch {
      setMsg({ type: "err", text: "خطأ في الاتصال." });
    } finally {
      setBusy(false);
    }
  }

  const activeBots = bots.filter((b) => b.status === "active");
  const stoppedBots = bots.filter((b) => b.status === "stopped");

  return (
    <FadeIn>
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="bento-card relative overflow-hidden p-6">
          <div
            className="pointer-events-none absolute inset-0 opacity-20"
            style={{
              background:
                "radial-gradient(ellipse at 90% 20%, rgba(59,130,246,0.35) 0%, transparent 55%)",
            }}
          />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-widest text-blue-400/70">
                استراتيجيات آلية
              </p>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                <Bot className="h-6 w-6 text-blue-400" />
                بوتات التداول
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                شبكة فوركس/كريبتو أو بوت ذهب XAUUSD — يعمل على السيرفر 24/7
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void refresh();
                void refreshMeta(formMarket);
              }}
              disabled={busy}
              className="btn btn-secondary inline-flex items-center gap-2 text-sm"
            >
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
              تحديث
            </button>
          </div>
        </div>

        {meta && <BrokerStatusPanel meta={meta} />}
        {meta && <AccountBalanceBar meta={meta} market={formMarket} />}

        <div className="bento-card flex gap-3 border-amber-500/25 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-sm text-zinc-400">
            <p className="font-medium text-amber-300">تنبيه مخاطر Martingale</p>
            <p className="mt-1 leading-relaxed">
              الشبكة المضاعفة قد تستهلك الهامش بسرعة. الوضع الافتراضي{" "}
              <strong className="text-zinc-300">حقيقي (live)</strong> — يُنفَّذ
              على حسابك عبر MT5 أو Binance بعد فحص Risk Guard. للتجربة بدون
              مخاطرة اختر{" "}
              <strong className="text-zinc-300">تجريبي (paper)</strong>.
              {liveEnabled
                ? " التنفيذ الحقيقي مفعّل على السيرفر."
                : " التنفيذ الحقيقي معطّل من الإدارة (BOTS_LIVE_ENABLED=0)."}
            </p>
          </div>
        </div>

        <SurfaceCard>
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <Grid3X3 className="h-4 w-4" />
              بوتاتي ({bots.length})
            </h2>
            {!showForm && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="btn btn-primary inline-flex items-center gap-2 text-sm"
              >
                <Play className="h-4 w-4" />
                بوت جديد
              </button>
            )}
          </div>

          {showForm && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setBotType("grid")}
                  className={cn(
                    "rounded-xl border p-4 text-start transition-colors",
                    botType === "grid"
                      ? "border-blue-500/40 bg-blue-500/10"
                      : "border-border bg-muted/10 hover:bg-muted/20",
                  )}
                >
                  <Grid3X3 className="mb-2 h-5 w-5 text-blue-400" />
                  <p className="font-medium">بوت شبكة</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    فوركس أو كريبتو — أي رمز، اتجاه يدوي
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setBotType("gold")}
                  className={cn(
                    "rounded-xl border p-4 text-start transition-colors",
                    botType === "gold"
                      ? "border-yellow-500/40 bg-yellow-500/10"
                      : "border-border bg-muted/10 hover:bg-muted/20",
                  )}
                >
                  <Sparkles className="mb-2 h-5 w-5 text-yellow-400" />
                  <p className="font-medium">بوت ذهب</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    XAUUSD فقط — شموع + شبكة مضاعفة
                  </p>
                </button>
              </div>

              {botType === "grid" ? (
                <GridBotForm
                  form={gridForm}
                  setForm={setGridForm}
                  meta={meta}
                  brokerConnected={brokerConnected}
                  busy={busy}
                  onSubmit={() => void createGridBot()}
                  onCancel={() => setShowForm(false)}
                  onSymbolsLoaded={handleSymbolsLoaded}
                />
              ) : (
                <GoldBotForm
                  form={goldForm}
                  setForm={setGoldForm}
                  meta={meta}
                  busy={busy}
                  onSubmit={() => void createGoldBot()}
                  onCancel={() => setShowForm(false)}
                />
              )}
            </>
          )}

          {msg && (
            <p
              className={cn(
                "mt-3 text-sm",
                msg.type === "ok" ? "text-emerald-500" : "text-red-500",
              )}
            >
              {msg.text}
            </p>
          )}

          {activeBots.length > 0 && (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                نشطة ({activeBots.length})
              </p>
              {activeBots.map((bot) => (
                <BotCard
                  key={bot.id}
                  bot={bot}
                  busy={busy}
                  onStop={(id) => void stopBot(id)}
                />
              ))}
            </div>
          )}

          {stoppedBots.length > 0 && (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                متوقفة ({stoppedBots.length})
              </p>
              {stoppedBots.map((bot) => (
                <BotCard
                  key={bot.id}
                  bot={bot}
                  busy={busy}
                  onStop={(id) => void stopBot(id)}
                />
              ))}
            </div>
          )}

          {bots.length === 0 && !showForm && (
            <p className="mt-4 text-sm text-muted-foreground">
              لا توجد بوتات بعد.{" "}
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="text-primary hover:underline"
              >
                أنشئ أول بوت
              </button>
            </p>
          )}
        </SurfaceCard>

        <p className="text-center text-xs text-zinc-600">
          يُحدَّث البوت كل دقيقة عبر cron على السيرفر ·{" "}
          <Link href="/console/connect" className="text-green-400 hover:underline">
            اربط حسابك
          </Link>{" "}
          للأسعار الحية
        </p>
      </div>
    </FadeIn>
  );
}
