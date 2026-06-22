"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Search,
  Star,
  Activity,
  Gauge,
  TrendingUp,
  TrendingDown,
  Grid3x3,
  BarChart3,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

type OnAction = (action: string, payload: any) => void;

const fmtPct = (n: number) =>
  `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

const pctTone = (n: number) =>
  n > 0
    ? "text-emerald-400"
    : n < 0
    ? "text-rose-400"
    : "text-muted-foreground";

const pctBg = (n: number) =>
  n > 0
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : n < 0
    ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
    : "bg-muted text-muted-foreground border-border";

/* ============================================================
 * 18. pair_browser — متصفّح أزواج الحساب
 * ============================================================ */
export function PairBrowser({
  symbols = [],
  onAction,
}: {
  symbols?: { symbol: string; market: string; bid: number; ask: number; spreadPct: number }[];
  onAction?: OnAction;
}) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"forex" | "crypto" | "all">("all");

  const filtered = symbols.filter((s) => {
    const okTab = tab === "all" ? true : s.market === tab;
    const okQ = q.trim()
      ? s.symbol.toLowerCase().includes(q.trim().toLowerCase())
      : true;
    return okTab && okQ;
  });

  const tabs: { key: "all" | "forex" | "crypto"; label: string }[] = [
    { key: "all", label: "الكل" },
    { key: "forex", label: "فوركس" },
    { key: "crypto", label: "كريبتو" },
  ];

  return (
    <div
      dir="rtl"
      className="w-full max-w-md rounded-2xl border border-border bg-card/80 backdrop-blur-md shadow-lg overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Search className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">متصفّح الأزواج</span>
      </div>

      <div className="p-3 space-y-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث عن زوج…"
            className="w-full rounded-xl bg-background border border-border pr-9 pl-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition"
          />
        </div>

        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex-1 rounded-lg py-1.5 text-xs font-medium transition",
                tab === t.key
                  ? "bg-card text-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-64 overflow-y-auto space-y-1 pr-0.5">
          {filtered.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">
              لا توجد أزواج مطابقة
            </div>
          )}
          {filtered.map((s) => (
            <button
              key={s.symbol}
              onClick={() => onAction?.("submit_prompt", { text: `حلّل ${s.symbol}` })}
              className="w-full group flex items-center justify-between rounded-xl border border-border bg-background/60 px-3 py-2 text-right hover:border-primary hover:bg-background transition"
            >
              <div className="flex flex-col items-start">
                <span className="text-sm font-semibold text-foreground">{s.symbol}</span>
                <span className="text-[10px] uppercase text-muted-foreground">{s.market}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end text-[11px]">
                  <span className="text-emerald-400 tabular-nums">{s.bid}</span>
                  <span className="text-rose-400 tabular-nums">{s.ask}</span>
                </div>
                <span
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums",
                    pctBg(0)
                  )}
                >
                  {s.spreadPct.toFixed(3)}%
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 19. watchlist — قائمة مراقبة مثبّتة
 * ============================================================ */
export function Watchlist({
  items = [],
  onAction,
}: {
  items?: { symbol: string; price: number; changePct: number }[];
  onAction?: OnAction;
}) {
  const [pinned, setPinned] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.symbol, true]))
  );

  const togglePin = (sym: string) =>
    setPinned((p) => ({ ...p, [sym]: !p[sym] }));

  const sorted = [...items].sort(
    (a, b) => Number(pinned[b.symbol] ?? 0) - Number(pinned[a.symbol] ?? 0)
  );

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card/80 backdrop-blur-md shadow-lg overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Star className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-semibold text-foreground">قائمة المراقبة</span>
      </div>
      <div className="p-2 space-y-1">
        {sorted.map((i) => (
          <div
            key={i.symbol}
            className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-2 py-2 hover:bg-background transition"
          >
            <button
              onClick={() => togglePin(i.symbol)}
              className="shrink-0"
              aria-label="تثبيت"
            >
              <Star
                className={cn(
                  "h-4 w-4 transition",
                  pinned[i.symbol]
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground"
                )}
              />
            </button>
            <button
              onClick={() =>
                onAction?.("submit_prompt", { text: `حلّل ${i.symbol}` })
              }
              className="flex flex-1 items-center justify-between text-right"
            >
              <span className="text-sm font-semibold text-foreground">{i.symbol}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm tabular-nums text-foreground">{i.price}</span>
                <span
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums",
                    pctBg(i.changePct)
                  )}
                >
                  {fmtPct(i.changePct)}
                </span>
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * 20. price_ticker — مؤشّر سعر لزوج واحد
 * ============================================================ */
export function PriceTicker({
  symbol = "—",
  price = 0,
  changePct = 0,
  onAction,
}: {
  symbol?: string;
  price?: number;
  changePct?: number;
  onAction?: OnAction;
}) {
  const [flash, setFlash] = useState(false);
  const up = changePct >= 0;

  const refresh = () => {
    setFlash(true);
    onAction?.("submit_prompt", { text: `حدّث سعر ${symbol}` });
    setTimeout(() => setFlash(false), 600);
  };

  return (
    <div
      dir="rtl"
      className={cn(
        "w-full max-w-xs rounded-2xl border bg-card/80 backdrop-blur-md shadow-lg p-4 transition-colors duration-500",
        flash
          ? up
            ? "border-emerald-500/60 bg-emerald-500/5"
            : "border-rose-500/60 bg-rose-500/5"
          : "border-border"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{symbol}</span>
        <button
          onClick={refresh}
          className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary transition"
        >
          تحديث
        </button>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <span
          className={cn(
            "text-3xl font-bold tabular-nums transition-colors",
            flash ? (up ? "text-emerald-400" : "text-rose-400") : "text-foreground"
          )}
        >
          {price}
        </span>
        <span
          className={cn(
            "flex items-center gap-1 rounded-lg border px-2 py-1 text-sm tabular-nums",
            pctBg(changePct)
          )}
        >
          {up ? (
            <TrendingUp className="h-4 w-4" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          )}
          {fmtPct(changePct)}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
 * 21. spread_monitor — شريط فارق السعر مقابل عتبة
 * ============================================================ */
export function SpreadMonitor({
  symbol = "—",
  spreadPct = 0,
  threshold = 0.05,
  onAction,
}: {
  symbol?: string;
  spreadPct?: number;
  threshold?: number;
  onAction?: OnAction;
}) {
  const [thr, setThr] = useState(threshold);
  const breached = spreadPct > thr;
  const max = Math.max(spreadPct, thr) * 1.6 || 1;
  const fill = Math.min(100, (spreadPct / max) * 100);
  const thrPos = Math.min(100, (thr / max) * 100);

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card/80 backdrop-blur-md shadow-lg p-4"
    >
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">مراقب الفارق</span>
        <span className="ms-auto text-xs text-muted-foreground">{symbol}</span>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">الفارق الحالي</span>
          <span
            className={cn(
              "tabular-nums font-semibold",
              breached ? "text-rose-400" : "text-emerald-400"
            )}
          >
            {spreadPct.toFixed(3)}%
          </span>
        </div>
        <div className="relative mt-2 h-3 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              breached ? "bg-rose-500" : "bg-emerald-500"
            )}
            style={{ width: `${fill}%` }}
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-amber-400"
            style={{ right: `${thrPos}%` }}
            title="العتبة"
          />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>العتبة</span>
          <span className="tabular-nums text-amber-400">{thr.toFixed(3)}%</span>
        </div>
        <input
          type="range"
          min={0.01}
          max={0.5}
          step={0.01}
          value={thr}
          onChange={(e) => setThr(parseFloat(e.target.value))}
          className="mt-1 w-full accent-amber-400"
        />
      </div>

      <button
        onClick={() =>
          onAction?.("submit_prompt", {
            text: `راقب فارق ${symbol} وحذّرني إذا تجاوز ${thr.toFixed(3)}%`,
          })
        }
        className="mt-3 w-full rounded-xl border border-border bg-background/60 py-2 text-xs font-medium text-foreground hover:border-primary transition"
      >
        فعّل التنبيه عند {thr.toFixed(3)}%
      </button>
    </div>
  );
}

/* ============================================================
 * 22. movers — أعلى الرابحين/الخاسرين
 * ============================================================ */
export function Movers({
  gainers = [],
  losers = [],
  onAction,
}: {
  gainers?: { symbol: string; changePct: number }[];
  losers?: { symbol: string; changePct: number }[];
  onAction?: OnAction;
}) {
  const [tab, setTab] = useState<"gainers" | "losers">("gainers");
  const rows = tab === "gainers" ? gainers : losers;

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card/80 backdrop-blur-md shadow-lg overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Activity className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">الأكثر حركة</span>
      </div>

      <div className="p-3">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          <button
            onClick={() => setTab("gainers")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium transition",
              tab === "gainers"
                ? "bg-emerald-500/15 text-emerald-400 shadow"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <TrendingUp className="h-3.5 w-3.5" /> الرابحون
          </button>
          <button
            onClick={() => setTab("losers")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium transition",
              tab === "losers"
                ? "bg-rose-500/15 text-rose-400 shadow"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <TrendingDown className="h-3.5 w-3.5" /> الخاسرون
          </button>
        </div>

        <div className="mt-3 space-y-1">
          {rows.map((r) => (
            <button
              key={r.symbol}
              onClick={() =>
                onAction?.("submit_prompt", { text: `حلّل ${r.symbol}` })
              }
              className="w-full flex items-center justify-between rounded-xl border border-border bg-background/60 px-3 py-2 hover:border-primary hover:bg-background transition"
            >
              <span className="text-sm font-semibold text-foreground">{r.symbol}</span>
              <span
                className={cn(
                  "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] tabular-nums",
                  pctBg(r.changePct)
                )}
              >
                {r.changePct >= 0 ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {fmtPct(r.changePct)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 23. heatmap — شبكة أزواج ملوّنة حسب التغيّر
 * ============================================================ */
export function Heatmap({
  cells = [],
  onAction,
}: {
  cells?: { symbol: string; changePct: number }[];
  onAction?: OnAction;
}) {
  const tone = (n: number) => {
    const a = Math.min(1, Math.abs(n) / 5);
    if (n > 0) return `rgba(16,185,129,${0.15 + a * 0.55})`;
    if (n < 0) return `rgba(244,63,94,${0.15 + a * 0.55})`;
    return "rgba(120,120,120,0.2)";
  };

  return (
    <div
      dir="rtl"
      className="w-full max-w-md rounded-2xl border border-border bg-card/80 backdrop-blur-md shadow-lg overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Grid3x3 className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">خريطة حرارية</span>
      </div>
      <div className="p-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {cells.map((c) => (
          <button
            key={c.symbol}
            onClick={() =>
              onAction?.("submit_prompt", { text: `حلّل ${c.symbol}` })
            }
            style={{ backgroundColor: tone(c.changePct) }}
            className="flex flex-col items-center justify-center rounded-xl border border-white/5 px-2 py-3 hover:scale-[1.03] transition-transform"
          >
            <span className="text-xs font-semibold text-foreground">{c.symbol}</span>
            <span className="text-[11px] tabular-nums text-foreground/90">
              {fmtPct(c.changePct)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * 24. change_grid — مقارنة تغيّر 24س (أعمدة)
 * ============================================================ */
export function ChangeGrid({
  items = [],
}: {
  items?: { symbol: string; changePct: number }[];
}) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.changePct)));

  return (
    <div
      dir="rtl"
      className="w-full max-w-md rounded-2xl border border-border bg-card/80 backdrop-blur-md shadow-lg overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">تغيّر 24 ساعة</span>
      </div>
      <div className="p-4">
        <div className="flex items-end justify-between gap-2 h-40">
          {items.map((i) => {
            const h = (Math.abs(i.changePct) / max) * 100;
            const up = i.changePct >= 0;
            return (
              <div key={i.symbol} className="flex flex-1 flex-col items-center gap-1">
                <span className={cn("text-[10px] tabular-nums", pctTone(i.changePct))}>
                  {fmtPct(i.changePct)}
                </span>
                <div className="flex w-full flex-1 items-end justify-center">
                  <div
                    className={cn(
                      "w-full max-w-[28px] rounded-t-md transition-all duration-500",
                      up ? "bg-emerald-500/70" : "bg-rose-500/70"
                    )}
                    style={{ height: `${Math.max(4, h)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                  {i.symbol}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * 25. depth_mini — أعمدة عمق (bids/asks)
 * ============================================================ */
export function DepthMini({
  bids = [],
  asks = [],
}: {
  bids?: { price: number; qty: number }[];
  asks?: { price: number; qty: number }[];
}) {
  const maxQty = Math.max(
    1,
    ...bids.map((b) => b.qty),
    ...asks.map((a) => a.qty)
  );

  return (
    <div
      dir="rtl"
      className="w-full max-w-sm rounded-2xl border border-border bg-card/80 backdrop-blur-md shadow-lg overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Layers className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">عمق السوق</span>
      </div>
      <div className="grid grid-cols-2 gap-3 p-3">
        {/* Bids */}
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-emerald-400 text-center">
            طلبات الشراء
          </div>
          {bids.map((b, idx) => (
            <div key={idx} className="relative h-6 rounded-md overflow-hidden bg-background/60">
              <div
                className="absolute inset-y-0 right-0 bg-emerald-500/25"
                style={{ width: `${(b.qty / maxQty) * 100}%` }}
              />
              <div className="relative flex h-full items-center justify-between px-2 text-[10px] tabular-nums">
                <span className="text-emerald-400">{b.price}</span>
                <span className="text-muted-foreground">{b.qty}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Asks */}
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-rose-400 text-center">
            طلبات البيع
          </div>
          {asks.map((a, idx) => (
            <div key={idx} className="relative h-6 rounded-md overflow-hidden bg-background/60">
              <div
                className="absolute inset-y-0 left-0 bg-rose-500/25"
                style={{ width: `${(a.qty / maxQty) * 100}%` }}
              />
              <div className="relative flex h-full items-center justify-between px-2 text-[10px] tabular-nums">
                <span className="text-rose-400">{a.price}</span>
                <span className="text-muted-foreground">{a.qty}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Registry map
 * ============================================================ */
export const MARKET_WIDGETS = {
  pair_browser: PairBrowser,
  watchlist: Watchlist,
  price_ticker: PriceTicker,
  spread_monitor: SpreadMonitor,
  movers: Movers,
  heatmap: Heatmap,
  change_grid: ChangeGrid,
  depth_mini: DepthMini,
};
