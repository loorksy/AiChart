"use client";

/**
 * Cumulative realized R over time — the record drawn as a curve. Pure SVG,
 * no chart library: one path over the equity points the stats module already
 * computed, a zero line, and the closing value. The SVG plots time left→right
 * regardless of RTL (a time axis is not prose), while labels around it follow
 * the app direction.
 */
import { useLocale } from "@/hooks/useLocale";
import type { EquityCurvePoint } from "@/lib/recommendations/recommendationStats";
import { cn } from "@/lib/utils";

const W = 640;
const H = 180;
const PAD = 12;

export function EquityCurveChart({ points }: { points: EquityCurvePoint[] }) {
  const { t } = useLocale();

  if (points.length === 0) {
    return (
      <div className="glass-card p-3">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          {t("stats.equity_curve")}
        </h3>
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t("stats.equity_curve_empty")}
        </p>
      </div>
    );
  }

  // Domain: pad time by one step on each side; R range always includes 0 so
  // the zero line (break-even) is on screen.
  const ts = points.map((p) => p.at);
  const rs = points.map((p) => p.cumR);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const spanT = Math.max(1, t1 - t0);
  const rMin = Math.min(0, ...rs);
  const rMax = Math.max(0, ...rs);
  const spanR = Math.max(0.5, rMax - rMin);

  const x = (at: number) => PAD + ((at - t0) / spanT) * (W - 2 * PAD);
  const y = (r: number) => H - PAD - ((r - rMin) / spanR) * (H - 2 * PAD);

  // Anchor the path at break-even before the first outcome.
  const path = [`M ${PAD} ${y(0).toFixed(1)}`]
    .concat(points.map((p) => `L ${x(p.at).toFixed(1)} ${y(p.cumR).toFixed(1)}`))
    .join(" ");

  const last = points[points.length - 1]!;
  const positive = last.cumR >= 0;
  const zeroY = y(0);

  return (
    <div className="glass-card p-3" data-testid="equity-curve">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("stats.equity_curve")}</h3>
        <span
          className={cn(
            "ms-auto font-mono text-sm font-bold tabular-nums",
            positive ? "text-buy" : "text-sell",
          )}
          dir="ltr"
        >
          {last.cumR > 0 ? "+" : ""}
          {last.cumR.toFixed(2)}R
        </span>
      </div>
      {/* dir=ltr on the wrapper: a time axis plots left→right even in RTL. */}
      <div dir="ltr">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-40 w-full"
          role="img"
          aria-label={t("stats.equity_curve")}
        >
          {/* Break-even line. */}
          <line
            x1={PAD}
            x2={W - PAD}
            y1={zeroY}
            y2={zeroY}
            stroke="currentColor"
            className="text-border"
            strokeDasharray="4 4"
            strokeWidth="1"
          />
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            className={positive ? "text-buy" : "text-sell"}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* Point markers with native tooltips when the record is small
              enough to read them; a dense curve stays a curve. */}
          {points.length <= 60
            ? points.map((p) => (
                <circle
                  key={p.id}
                  cx={x(p.at)}
                  cy={y(p.cumR)}
                  r="2.5"
                  className={p.r >= 0 ? "fill-buy" : "fill-sell"}
                >
                  <title>
                    {`${p.r > 0 ? "+" : ""}${p.r.toFixed(2)}R → ${p.cumR > 0 ? "+" : ""}${p.cumR.toFixed(2)}R`}
                  </title>
                </circle>
              ))
            : null}
        </svg>
      </div>
    </div>
  );
}
