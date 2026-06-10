"use client";

import { useEffect, useState } from "react";
import { Loader2, Radar } from "lucide-react";
import { SurfaceCard } from "@/components/ui/shell";
import type { OpportunityScanResult } from "@/lib/opportunityScan";
import type { MarketType } from "@/lib/markets/types";
import { normalizeInterval } from "@/lib/intervals";

const LS_SYMBOL = "aichart_last_symbol";
const LS_MARKET = "aichart_last_market";

export function OpportunityScanCard({
  onScanComplete,
  analysisInterval = "1h",
  activeMarket = "crypto",
}: {
  onScanComplete?: (result: OpportunityScanResult) => void;
  analysisInterval?: string;
  activeMarket?: MarketType;
}) {
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [focusOnly, setFocusOnly] = useState(false);
  const [focusSymbol, setFocusSymbol] = useState("");
  const [result, setResult] = useState<OpportunityScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const interval = normalizeInterval(analysisInterval);

  useEffect(() => {
    try {
      const sym = localStorage.getItem(LS_SYMBOL);
      const mkt = localStorage.getItem(LS_MARKET);
      if (sym && mkt === activeMarket) {
        setFocusSymbol(sym);
      }
    } catch {
      /* ignore */
    }
  }, [activeMarket]);

  async function runScan() {
    setBusy(true);
    setError(null);
    try {
      const symbol = focusOnly ? focusSymbol.trim().toUpperCase() : undefined;
      const res = await fetch("/api/opportunities/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deep,
          skipCooldown: true,
          interval,
          market: activeMarket,
          symbol,
          focusOnly: focusOnly && Boolean(symbol),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "تعذّر المسح.");
        return;
      }
      const scan = data as OpportunityScanResult;
      setResult(scan);
      onScanComplete?.(scan);
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SurfaceCard className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">ابحث عن صفقة</h2>
          <p className="text-sm text-muted-foreground">
            مسح على إطار {interval} · {activeMarket === "forex" ? "فوركس" : "كريبتو"}
          </p>
        </div>
        <Radar className="h-5 w-5 shrink-0 text-chart-1" />
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={deep}
          onChange={(e) => setDeep(e.target.checked)}
          className="rounded border-border"
        />
        تحليل عميق بالذكاء الاصطناعي (يستهلك رصيد)
      </label>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={focusOnly}
          onChange={(e) => setFocusOnly(e.target.checked)}
          className="rounded border-border"
        />
        مسح زوج واحد فقط
      </label>

      {focusOnly && (
        <input
          type="text"
          className="input"
          dir="ltr"
          placeholder="BTCUSDT أو EURUSD"
          value={focusSymbol}
          onChange={(e) => setFocusSymbol(e.target.value.toUpperCase())}
        />
      )}

      <button
        type="button"
        onClick={() => void runScan()}
        disabled={busy || (focusOnly && !focusSymbol.trim())}
        className="btn btn-primary w-full"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            جارٍ المسح…
          </>
        ) : (
          "ابحث عن صفقة الآن"
        )}
      </button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            إطار {result.interval} ·{" "}
            {result.market === "forex" ? "فوركس" : "كريبتو"} — فُحص{" "}
            {result.symbolsChecked} زوج — {result.candidates.length} فرصة
          </p>
          {result.candidates.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-border/50 bg-secondary/30 p-2">
              {result.candidates.slice(0, 8).map((c) => (
                <li key={`${c.symbol}-${c.interval}`} className="flex justify-between gap-2">
                  <span dir="ltr" className="font-medium">
                    {c.symbol} · {c.interval}
                  </span>
                  <span className="text-muted-foreground">
                    نقاط {c.score} · {c.signals[0]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {result.deepAnalysis?.recommendation && (
            <p className="rounded-lg border border-primary/30 bg-primary/5 p-2">
              تحليل عميق: {result.deepAnalysis.recommendation.symbol}{" "}
              {result.deepAnalysis.recommendation.timeframe ?? result.interval}{" "}
              {result.deepAnalysis.recommendation.action}{" "}
              ({result.deepAnalysis.recommendation.confidence}%)
            </p>
          )}
          {result.errors.length > 0 && (
            <p className="text-xs text-amber-600">{result.errors.join(" · ")}</p>
          )}
        </div>
      )}
    </SurfaceCard>
  );
}
