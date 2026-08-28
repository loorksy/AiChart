/**
 * The shareable Lonora profit card — dark gold, Bybit-style structure,
 * on-brand mark, real recommendation numbers. Rendered off-screen at a
 * fixed 360px width so html-to-image captures a consistent PNG.
 */
"use client";

import type { CSSProperties } from "react";
import { BRAND_DOMAIN, BRAND_NAME } from "@/lib/brand";
import {
  PROFIT_CARD_LOGO_SRC,
  formatCardDate,
  formatCardPrice,
  formatPnlPercent,
  type ProfitCardModel,
} from "@/lib/recommendations/profitCard";

const W = 360;
const H = 580;

export function ProfitCard({
  model,
  displayName,
  labels,
}: {
  model: ProfitCardModel;
  displayName?: string | null;
  labels: {
    badge: string;
    pnlKind: string;
    side: string;
    mark: string;
    entry: string;
    date: string;
    tagline: string;
  };
}) {
  const gain = !model.isLoss;
  const pctColor = gain ? "#f0d078" : "#f07167";
  const pctGlow = gain ? "rgba(240, 208, 120, 0.45)" : "rgba(240, 113, 103, 0.4)";
  const barsFlip = model.dir === "rtl" ? "scaleX(-1)" : undefined;

  return (
    <article
      data-testid="profit-card"
      dir={model.dir}
      style={{
        width: "100%",
        maxWidth: W,
        minHeight: H,
        height: "auto",
        boxSizing: "border-box",
        position: "relative",
        overflow: "hidden",
        padding: "22px 22px 20px",
        display: "flex",
        flexDirection: "column",
        color: "#f3e6c4",
        fontFamily: 'var(--font-cairo), Cairo, "Segoe UI", sans-serif',
        background:
          "radial-gradient(120% 80% at 80% -10%, rgba(212, 175, 55, 0.22), transparent 52%), linear-gradient(165deg, #14100b 0%, #0c0a07 48%, #120e09 100%)",
        border: "1px solid rgba(212, 175, 55, 0.28)",
        borderRadius: 28,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(212,175,55,0.08) 0%, transparent 28%, transparent 72%, rgba(0,0,0,0.35) 100%)",
          pointerEvents: "none",
        }}
      />

      <header
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- capture target; next/image is unreliable for html-to-image */}
          <img
            src={PROFIT_CARD_LOGO_SRC}
            alt=""
            width={36}
            height={36}
            style={{ width: 36, height: 36, objectFit: "contain" }}
          />
          <span
            style={{
              fontFamily: "var(--font-fraunces), Fraunces, Georgia, serif",
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: "#f8e7a8",
            }}
          >
            {BRAND_NAME}
          </span>
        </span>
        <span
          style={{
            flexShrink: 0,
            borderRadius: 999,
            border: "1px solid rgba(212, 175, 55, 0.45)",
            background: "rgba(212, 175, 55, 0.12)",
            color: "#e8c04a",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.02em",
            padding: "5px 10px",
            whiteSpace: "nowrap",
          }}
        >
          {labels.badge}
        </span>
      </header>

      <div style={{ position: "relative", zIndex: 1, marginTop: 28 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            color: "#b5a178",
            letterSpacing: "0.02em",
          }}
        >
          {labels.pnlKind}
        </p>
        <p
          style={{
            margin: "6px 0 0",
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span
            dir="ltr"
            style={{
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#f3e6c4",
            }}
          >
            {model.symbol}
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: gain ? "#e8c04a" : "#f07167",
            }}
          >
            {labels.side}
          </span>
        </p>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 18,
          minHeight: 118,
        }}
      >
        <p
          dir="ltr"
          data-testid="profit-card-pnl"
          style={{
            margin: 0,
            fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
            fontSize: 56,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            color: pctColor,
            textShadow: `0 0 28px ${pctGlow}`,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatPnlPercent(model.pnlPct)}
        </p>
        <GoldBars style={{ position: "absolute", top: -8, insetInlineEnd: -18, transform: barsFlip }} />
      </div>

      <dl
        style={{
          position: "relative",
          zIndex: 1,
          margin: "22px 0 0",
          padding: "14px 0",
          borderTop: "1px solid rgba(212, 175, 55, 0.22)",
          borderBottom: "1px solid rgba(212, 175, 55, 0.22)",
          display: "grid",
          gap: 10,
        }}
      >
        <Row
          label={labels.mark}
          value={model.markPrice != null ? formatCardPrice(model.markPrice) : "—"}
        />
        <Row label={labels.entry} value={formatCardPrice(model.entry)} />
        <Row label={labels.date} value={formatCardDate(model.dateMs)} />
      </dl>

      <footer
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: "auto",
          paddingTop: 16,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {displayName ? (
            <p
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                color: "#f8e7a8",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {displayName}
            </p>
          ) : null}
          <p
            style={{
              margin: displayName ? "4px 0 0" : 0,
              fontSize: 12,
              color: "#b5a178",
            }}
          >
            {labels.tagline}
          </p>
          <p
            dir="ltr"
            style={{
              margin: "8px 0 0",
              fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.02em",
              color: "#c9a227",
            }}
          >
            {BRAND_DOMAIN}
          </p>
        </div>
        <BrandUrlQr />
      </footer>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <dt style={{ fontSize: 12, color: "#b5a178" }}>{label}</dt>
      <dd
        dir="ltr"
        style={{
          margin: 0,
          fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
          fontSize: 14,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: "#f3e6c4",
        }}
      >
        {value}
      </dd>
    </div>
  );
}

/** Tasteful isometric bullion — decorative, RTL-mirrored by the parent. */
function GoldBars({ style }: { style?: CSSProperties }) {
  return (
    <svg
      width="168"
      height="132"
      viewBox="0 0 168 132"
      fill="none"
      aria-hidden
      style={{ pointerEvents: "none", opacity: 0.92, ...style }}
    >
      <path d="M28 94 L78 78 L148 92 L98 112 Z" fill="#8a6a1a" />
      <path d="M28 94 L28 108 L98 126 L98 112 Z" fill="#6e5414" />
      <path d="M148 92 L148 106 L98 126 L98 112 Z" fill="#c4a035" />
      <path d="M38 72 L88 56 L150 70 L100 88 Z" fill="#d4b44a" />
      <path d="M38 72 L38 84 L100 100 L100 88 Z" fill="#a07e22" />
      <path d="M150 70 L150 82 L100 100 L100 88 Z" fill="#f0d078" />
      <path d="M22 52 L72 36 L138 50 L88 68 Z" fill="#f3dc8a" />
      <path d="M22 52 L22 64 L88 80 L88 68 Z" fill="#b8922c" />
      <path d="M138 50 L138 62 L88 80 L88 68 Z" fill="#fff3c0" />
    </svg>
  );
}

/** Real QR of https://aichart.lork.cloud — cream plate, dark modules. */
function BrandUrlQr() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 33 33"
      shapeRendering="crispEdges"
      aria-hidden
      style={{
        flexShrink: 0,
        borderRadius: 8,
        background: "#f6edd4",
        boxShadow: "0 0 0 3px rgba(212,175,55,0.25)",
      }}
    >
      <rect width="33" height="33" fill="#f6edd4" />
      <path
        stroke="#1a1408"
        fill="none"
        d="M4 4.5h7m2 0h1m2 0h2m2 0h1m1 0h7M4 5.5h1m5 0h1m3 0h1m2 0h3m2 0h1m5 0h1M4 6.5h1m1 0h3m1 0h1m1 0h2m2 0h1m1 0h3m1 0h1m1 0h3m1 0h1M4 7.5h1m1 0h3m1 0h1m1 0h2m1 0h1m1 0h2m3 0h1m1 0h3m1 0h1M4 8.5h1m1 0h3m1 0h1m1 0h1m1 0h1m3 0h1m1 0h1m1 0h1m1 0h3m1 0h1M4 9.5h1m5 0h1m1 0h1m1 0h1m1 0h2m1 0h1m2 0h1m5 0h1M4 10.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M12 11.5h2m6 0h1M4 12.5h1m1 0h5m3 0h5m3 0h5M8 13.5h1m4 0h2m2 0h1m5 0h1m3 0h1M5 14.5h2m3 0h1m1 0h6m1 0h1m3 0h1m1 0h1m1 0h2M4 15.5h1m1 0h1m1 0h2m1 0h2m1 0h3m1 0h5m5 0h1M4 16.5h4m2 0h1m2 0h5m1 0h4m1 0h1m1 0h3M4 17.5h1m2 0h3m1 0h2m1 0h1m1 0h2m2 0h1m2 0h1m1 0h1m1 0h1M4 18.5h1m1 0h1m1 0h5m3 0h4m2 0h4m1 0h2M4 19.5h1m3 0h2m11 0h1m1 0h2m3 0h1M4 20.5h1m2 0h6m3 0h9m1 0h1M12 21.5h2m1 0h1m4 0h1m3 0h2M4 22.5h7m3 0h1m2 0h1m2 0h1m1 0h1m1 0h1m1 0h3M4 23.5h1m5 0h1m1 0h1m1 0h1m3 0h1m1 0h1m3 0h2M4 24.5h1m1 0h3m1 0h1m1 0h1m1 0h1m2 0h8m1 0h1M4 25.5h1m1 0h3m1 0h1m1 0h2m1 0h1m1 0h1m3 0h2m1 0h5M4 26.5h1m1 0h3m1 0h1m1 0h1m5 0h2m5 0h2m1 0h1M4 27.5h1m5 0h1m3 0h2m3 0h2m2 0h3m2 0h1M4 28.5h7m1 0h1m2 0h4m3 0h7"
      />
    </svg>
  );
}

export const PROFIT_CARD_SIZE = { width: W, height: H };
