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
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { SurfaceCard } from "@/components/ui/shell";
import { breakEven } from "@/lib/strategies/gridBot";
import { cn } from "@/lib/utils";

type BotSide = "buy" | "sell";
type BotMarket = "forex" | "crypto";
type ExecutionMode = "paper" | "live";
type BotStatus = "active" | "stopped";

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
  config: {
    side: BotSide;
    initialLot: number;
    gridStep: number;
    multiplier: number;
    takeProfit: number;
    maxLevels: number;
    maxTotalLot: number;
  };
  state: { levels: GridLevel[] };
  status: BotStatus;
  executionMode: ExecutionMode;
  realizedPnl: number;
  stopReason: string | null;
}

interface BotsResponse {
  bots: BotSession[];
  meta?: { liveEnabled: boolean };
}

const DEFAULT_FORM = {
  symbol: "XAUUSD",
  market: "forex" as BotMarket,
  side: "sell" as BotSide,
  executionMode: "paper" as ExecutionMode,
  initialLot: 0.01,
  gridStep: 2,
  multiplier: 2,
  takeProfit: 1,
  maxLevels: 5,
  maxTotalLot: 0.5,
};

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
  const levels = bot.state.levels;
  const be = levels.length ? breakEven(levels) : 0;
  const lotSum = totalLot(levels);
  const active = bot.status === "active";

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        active
          ? "border-emerald-500/25 bg-emerald-500/5"
          : "border-border bg-muted/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold" dir="ltr">
              {bot.symbol}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                bot.side === "sell"
                  ? "bg-rose-500/15 text-rose-400"
                  : "bg-emerald-500/15 text-emerald-400",
              )}
            >
              {bot.side === "sell" ? "بيع" : "شراء"}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {bot.market === "forex" ? "فوركس" : "كريبتو"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            شبكة · {bot.executionMode === "live" ? "حقيقي" : "تجريبي"} · #
            {bot.id}
          </p>
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
            {levels.length} / {bot.config.maxLevels}
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
  const [form, setForm] = useState(DEFAULT_FORM);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/bots", { cache: "no-store" });
      if (!r.ok) return;
      const d: BotsResponse = await r.json();
      setBots(d.bots ?? []);
      setLiveEnabled(Boolean(d.meta?.liveEnabled));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasActive = useMemo(
    () => bots.some((b) => b.status === "active"),
    [bots],
  );

  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [hasActive, refresh]);

  async function createBot() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: "grid",
          symbol: form.symbol.trim().toUpperCase(),
          market: form.market,
          side: form.side,
          executionMode: form.executionMode,
          config: {
            initialLot: form.initialLot,
            gridStep: form.gridStep,
            multiplier: form.multiplier,
            takeProfit: form.takeProfit,
            maxLevels: form.maxLevels,
            maxTotalLot: form.maxTotalLot,
          },
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ type: "err", text: d.error ?? "تعذّر إنشاء البوت." });
        return;
      }
      setMsg({ type: "ok", text: "تم تشغيل البوت — يعمل على السيرفر 24/7." });
      setShowForm(false);
      setForm(DEFAULT_FORM);
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
                بوت الشبكة
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                يعمل على السيرفر — لا يحتاج EA ولا MT5 مفتوح على جهازك
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              className="btn btn-secondary inline-flex items-center gap-2 text-sm"
            >
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
              تحديث
            </button>
          </div>
        </div>

        <div className="bento-card flex gap-3 border-amber-500/25 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-sm text-zinc-400">
            <p className="font-medium text-amber-300">تنبيه مخاطر Martingale</p>
            <p className="mt-1 leading-relaxed">
              الشبكة المضاعفة قد تستهلك الهامش بسرعة. ابدأ دائماً بوضع{" "}
              <strong className="text-zinc-300">تجريبي (paper)</strong>. التنفيذ
              الحقيقي {liveEnabled ? "مفعّل على السيرفر" : "معطّل حالياً"} —
              حتى مع اختيار live يُطبَّق paper لحين المعايرة.
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
            <div className="mt-4 space-y-4 border-b border-border pb-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="font-medium">الرمز</span>
                  <input
                    className="input mt-1 w-full"
                    value={form.symbol}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, symbol: e.target.value }))
                    }
                    placeholder="XAUUSD أو BTCUSDT"
                    dir="ltr"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">السوق</span>
                  <select
                    className="input mt-1 w-full"
                    value={form.market}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        market: e.target.value as BotMarket,
                      }))
                    }
                  >
                    <option value="forex">فوركس / MT5</option>
                    <option value="crypto">كريبتو / Binance</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-medium">الاتجاه</span>
                  <select
                    className="input mt-1 w-full"
                    value={form.side}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        side: e.target.value as BotSide,
                      }))
                    }
                  >
                    <option value="sell">بيع (شبكة هبوطية)</option>
                    <option value="buy">شراء (شبكة صعودية)</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-medium">وضع التنفيذ</span>
                  <select
                    className="input mt-1 w-full"
                    value={form.executionMode}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        executionMode: e.target.value as ExecutionMode,
                      }))
                    }
                  >
                    <option value="paper">تجريبي — محاكاة على السيرفر</option>
                    <option value="live">حقيقي — صفقات فعلية</option>
                  </select>
                </label>
              </div>

              <p className="text-xs text-muted-foreground">
                المسافات بالوحدات السعرية (مثلاً XAUUSD: gridStep=2 ≈ $2 بين
                المستويات). للذهب 20 نقطة ≈ 2.0 حسب الوسيط.
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="font-medium">لوت أول صفقة</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="input mt-1 w-full"
                    value={form.initialLot}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        initialLot: Number(e.target.value) || 0.01,
                      }))
                    }
                    dir="ltr"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">خطوة الشبكة</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.01"
                    className="input mt-1 w-full"
                    value={form.gridStep}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        gridStep: Number(e.target.value) || 1,
                      }))
                    }
                    dir="ltr"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">المضاعف</span>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="3"
                    className="input mt-1 w-full"
                    value={form.multiplier}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        multiplier: Number(e.target.value) || 1,
                      }))
                    }
                    dir="ltr"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">هدف الربح (سعر)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.01"
                    className="input mt-1 w-full"
                    value={form.takeProfit}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        takeProfit: Number(e.target.value) || 0.1,
                      }))
                    }
                    dir="ltr"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">أقصى مستويات</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    className="input mt-1 w-full"
                    value={form.maxLevels}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        maxLevels: Number(e.target.value) || 1,
                      }))
                    }
                    dir="ltr"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium">أقصى لوت إجمالي</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="input mt-1 w-full"
                    value={form.maxTotalLot}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        maxTotalLot: Number(e.target.value) || 0.01,
                      }))
                    }
                    dir="ltr"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void createBot()}
                  disabled={busy}
                  className="btn btn-primary inline-flex items-center gap-2 text-sm"
                >
                  {form.side === "sell" ? (
                    <TrendingDown className="h-4 w-4" />
                  ) : (
                    <TrendingUp className="h-4 w-4" />
                  )}
                  تشغيل البوت
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={busy}
                  className="btn btn-secondary text-sm"
                >
                  إلغاء
                </button>
              </div>
            </div>
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
                أنشئ أول بوت شبكة
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
