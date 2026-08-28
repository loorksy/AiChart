/**
 * The shareable Lonora profit card — compact dark-gold Bybit-style layout,
 * English LTR, green profit / red loss. Rendered at a fixed 360×400 so
 * html-to-image captures a consistent PNG with no empty canvas.
 */
"use client";

import type { CSSProperties } from "react";
import { BRAND_DOMAIN, BRAND_NAME } from "@/lib/brand";
import {
  PROFIT_CARD_BG,
  PROFIT_CARD_HEIGHT,
  PROFIT_CARD_LOGO_SRC,
  PROFIT_CARD_WIDTH,
  formatCardDate,
  formatCardPrice,
  formatPnlPercent,
  pnlAccentColor,
  pnlAccentGlow,
  type ProfitCardLabels,
  type ProfitCardModel,
} from "@/lib/recommendations/profitCard";

const W = PROFIT_CARD_WIDTH;
const H = PROFIT_CARD_HEIGHT;
const SANS = 'var(--font-inter), Inter, "Segoe UI", sans-serif';
const MONO = "var(--font-jetbrains), ui-monospace, monospace";

export function ProfitCard({
  model,
  displayName,
  labels,
  logoSrc,
}: {
  model: ProfitCardModel;
  displayName?: string | null;
  labels: ProfitCardLabels;
  logoSrc?: string;
}) {
  const gain = !model.isLoss;
  const pctColor = pnlAccentColor(model.isLoss);
  const pctGlow = pnlAccentGlow(model.isLoss);

  return (
    <article
      data-testid="profit-card"
      dir="ltr"
      style={{
        width: "100%",
        maxWidth: W,
        height: H,
        boxSizing: "border-box",
        position: "relative",
        overflow: "hidden",
        padding: "16px 16px 14px",
        display: "flex",
        flexDirection: "column",
        color: "#f4f1ea",
        fontFamily: SANS,
        background: `radial-gradient(110% 70% at 88% -8%, rgba(212, 175, 55, 0.18), transparent 48%), linear-gradient(165deg, #16181c 0%, ${PROFIT_CARD_BG} 46%, #0b0c0e 100%)`,
        border: "1px solid rgba(212, 175, 55, 0.28)",
        borderRadius: 26,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(212,175,55,0.07) 0%, transparent 26%, transparent 78%, rgba(0,0,0,0.28) 100%)",
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
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- capture target; next/image is unreliable for html-to-image */}
          <img
            src={logoSrc ?? PROFIT_CARD_LOGO_SRC}
            alt=""
            width={28}
            height={28}
            crossOrigin="anonymous"
            decoding="async"
            style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: "#f8f5ef",
            }}
          >
            {BRAND_NAME}
          </span>
        </span>
        <span
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            borderRadius: 999,
            border: "1px solid rgba(212, 175, 55, 0.45)",
            background: "rgba(212, 175, 55, 0.10)",
            color: "#f0e2b0",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            padding: "4px 9px",
            whiteSpace: "nowrap",
          }}
        >
          <Sparkle />
          {labels.badge}
        </span>
      </header>

      <div style={{ position: "relative", zIndex: 1, marginTop: 14, flexShrink: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            color: "#9a9386",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {labels.pnlKind}
        </p>
        <p
          style={{
            margin: "5px 0 0",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span
            dir="ltr"
            style={{
              fontFamily: MONO,
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "#f8f5ef",
            }}
          >
            {model.symbol}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 999,
              border: "1px solid rgba(212, 175, 55, 0.4)",
              background: "rgba(212, 175, 55, 0.12)",
              color: "#e8c04a",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.02em",
              padding: "2px 8px",
            }}
          >
            {labels.side}
          </span>
        </p>

        <div style={{ position: "relative", marginTop: 8, minHeight: 56, paddingRight: 108 }}>
          <p
            dir="ltr"
            data-testid="profit-card-pnl"
            data-pnl-tone={gain ? "gain" : "loss"}
            style={{
              margin: 0,
              fontFamily: MONO,
              fontSize: 42,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              color: pctColor,
              textShadow: `0 0 22px ${pctGlow}`,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatPnlPercent(model.pnlPct)}
          </p>
          <GoldGraphic gain={gain} style={{ position: "absolute", top: -18, right: -8 }} />
        </div>
      </div>

      <dl
        style={{
          position: "relative",
          zIndex: 1,
          margin: "12px 0 0",
          padding: "8px 12px",
          borderRadius: 14,
          background: "rgba(255, 255, 255, 0.035)",
          border: "1px solid rgba(212, 175, 55, 0.14)",
          display: "grid",
          gap: 0,
          flexShrink: 0,
        }}
      >
        <Row
          icon="price"
          label={labels.mark}
          value={model.markPrice != null ? formatCardPrice(model.markPrice) : "—"}
        />
        <Row icon="entry" label={labels.entry} value={formatCardPrice(model.entry)} />
        <Row icon="date" label={labels.date} value={formatCardDate(model.dateMs)} last />
      </dl>

      <footer
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: "auto",
          paddingTop: 12,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          {displayName ? (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 700,
                color: "#f0d078",
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
              margin: displayName ? "3px 0 0" : 0,
              fontSize: 11,
              color: "#9a9386",
            }}
          >
            {labels.tagline}
          </p>
          <p
            dir="ltr"
            style={{
              margin: "6px 0 0",
              fontFamily: MONO,
              fontSize: 10,
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

function Row({
  label,
  value,
  icon,
  last,
}: {
  label: string;
  value: string;
  icon: "price" | "entry" | "date";
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "7px 0",
        borderBottom: last ? "none" : "1px solid rgba(212, 175, 55, 0.10)",
      }}
    >
      <dt
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "#9a9386",
          margin: 0,
        }}
      >
        <RowIcon kind={icon} />
        {label}
      </dt>
      <dd
        dir="ltr"
        style={{
          margin: 0,
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: "#f4f1ea",
        }}
      >
        {value}
      </dd>
    </div>
  );
}

function RowIcon({ kind }: { kind: "price" | "entry" | "date" }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    fill: "none",
    "aria-hidden": true as const,
    style: { flexShrink: 0, opacity: 0.75 },
  };
  if (kind === "price") {
    return (
      <svg {...common}>
        <path d="M1.5 8.5 L4 5.5 L6 7 L10.5 2.5" stroke="#c9a227" strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="10.5" cy="2.5" r="1" fill="#c9a227" />
      </svg>
    );
  }
  if (kind === "entry") {
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="4" stroke="#c9a227" strokeWidth="1.3" />
        <circle cx="6" cy="6" r="1.4" fill="#c9a227" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="1.5" y="2.5" width="9" height="8" rx="1.2" stroke="#c9a227" strokeWidth="1.3" />
      <path d="M1.5 5h9M4 1.5v2M8 1.5v2" stroke="#c9a227" strokeWidth="1.3" />
    </svg>
  );
}

function Sparkle() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M5 0 L6 3.8 L10 5 L6 6.2 L5 10 L4 6.2 L0 5 L4 3.8 Z" fill="#e8c04a" />
    </svg>
  );
}

/** Compact bullion + sparkline — sits beside the %, does not stretch the card. */
function GoldGraphic({ gain, style }: { gain: boolean; style?: CSSProperties }) {
  const spark = gain
    ? "M8 62 C 22 58, 30 44, 44 40 S 64 28, 80 16 S 100 8, 112 6"
    : "M8 14 C 22 18, 30 32, 44 38 S 64 50, 80 58 S 100 70, 112 74";
  return (
    <svg
      width="116"
      height="92"
      viewBox="0 0 116 92"
      fill="none"
      aria-hidden
      style={{ pointerEvents: "none", opacity: 0.95, ...style }}
    >
      <path d={spark} stroke="rgba(232, 192, 74, 0.55)" strokeWidth="1.6" fill="none" />
      <circle cx="112" cy={gain ? 6 : 74} r="2.4" fill="#f0d078" />
      <ellipse cx="64" cy="84" rx="34" ry="6" fill="rgba(201, 162, 39, 0.18)" />
      <path d="M28 64 L62 52 L102 62 L68 76 Z" fill="#8a6a1a" />
      <path d="M28 64 L28 74 L68 86 L68 76 Z" fill="#6e5414" />
      <path d="M102 62 L102 72 L68 86 L68 76 Z" fill="#c4a035" />
      <path d="M22 46 L56 34 L98 44 L64 58 Z" fill="#e0c056" />
      <path d="M22 46 L22 56 L64 68 L64 58 Z" fill="#a07e22" />
      <path d="M98 44 L98 54 L64 68 L64 58 Z" fill="#f3dc8a" />
    </svg>
  );
}

/** Real QR of https://aichart.lork.cloud — cream plate, dark modules. */
function BrandUrlQr() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 33 33"
      shapeRendering="crispEdges"
      aria-hidden
      style={{
        flexShrink: 0,
        borderRadius: 7,
        background: "#f6edd4",
        boxShadow: "0 0 0 2px rgba(212,175,55,0.22)",
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
