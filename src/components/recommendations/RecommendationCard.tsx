/**
 * The shareable Lonora recommendation card — the plan the agent issued.
 * Compact dark layout, current locale (ar RTL / en LTR), green TPs / red SL.
 * Rendered at a fixed 360×520 so html-to-image captures a consistent PNG.
 */
"use client";

import type { ReactNode } from "react";
import { BRAND_NAME } from "@/lib/brand";
import {
  REC_CARD_BG,
  REC_CARD_GAIN_COLOR,
  REC_CARD_HEIGHT,
  REC_CARD_LOGO_SRC,
  REC_CARD_LOSS_COLOR,
  REC_CARD_WIDTH,
  formatCardPrice,
  formatRecCardDate,
  formatSignedR,
  recCardHeroFill,
  recCardSideColor,
  type RecommendationCardLabels,
  type RecommendationCardModel,
} from "@/lib/recommendations/recommendationCard";

const W = REC_CARD_WIDTH;
const H = REC_CARD_HEIGHT;
const SANS = 'var(--font-inter), Inter, "Segoe UI", "Noto Naskh Arabic", sans-serif';
const MONO = "var(--font-jetbrains), ui-monospace, monospace";

export function RecommendationCard({
  model,
  labels,
  logoSrc,
}: {
  model: RecommendationCardModel;
  labels: RecommendationCardLabels;
  logoSrc?: string;
}) {
  const sideColor = recCardSideColor(model.direction);
  const heroFill = recCardHeroFill(model.direction);
  const rColor = model.isLoss ? REC_CARD_LOSS_COLOR : REC_CARD_GAIN_COLOR;
  const targetLabels = [labels.target1, labels.target2, labels.target3];

  return (
    <article
      data-testid="recommendation-card-share"
      dir={model.dir}
      style={{
        width: "100%",
        maxWidth: W,
        height: H,
        boxSizing: "border-box",
        position: "relative",
        overflow: "hidden",
        padding: "12px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 0,
        color: "#f4f1ea",
        fontFamily: SANS,
        background: `linear-gradient(180deg, #16181c 0%, ${REC_CARD_BG} 42%, #0b0c0e 100%)`,
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 22,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- capture target; next/image is unreliable for html-to-image */}
          <img
            src={logoSrc ?? REC_CARD_LOGO_SRC}
            alt=""
            width={24}
            height={24}
            crossOrigin="anonymous"
            decoding="async"
            style={{ width: 24, height: 24, objectFit: "contain", flexShrink: 0 }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#f8f5ef" }}>{BRAND_NAME}</span>
        </span>
        <span
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            borderRadius: 999,
            border: `1px solid ${REC_CARD_GAIN_COLOR}55`,
            background: `${REC_CARD_GAIN_COLOR}18`,
            color: REC_CARD_GAIN_COLOR,
            fontSize: 10,
            fontWeight: 700,
            padding: "3px 8px",
            whiteSpace: "nowrap",
          }}
        >
          {labels.status}
        </span>
      </header>

      <div
        style={{
          marginTop: 10,
          padding: "10px 12px 12px",
          borderRadius: 14,
          background: heroFill,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {labels.setup ? <Chip>{labels.setup}</Chip> : null}
          {model.interval ? (
            <Chip>
              <span dir="ltr">{model.interval}</span>
            </Chip>
          ) : null}
          {labels.planType ? <Chip>{labels.planType}</Chip> : null}
        </div>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: 11,
                fontWeight: 700,
                color: sideColor,
              }}
            >
              {labels.signal}
            </p>
            <p
              dir="ltr"
              style={{
                margin: "2px 0 0",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: MONO,
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                color: "#f8f5ef",
              }}
            >
              {model.symbol}
              <SideArrow sell={model.direction === "sell"} color={sideColor} />
            </p>
          </div>
          {labels.goalStatus ? (
            <span
              data-testid="recommendation-card-goal"
              style={{
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                borderRadius: 999,
                background: `${REC_CARD_GAIN_COLOR}22`,
                color: REC_CARD_GAIN_COLOR,
                fontSize: 10,
                fontWeight: 700,
                padding: "4px 8px",
              }}
            >
              <CheckMini />
              {labels.goalStatus}
            </span>
          ) : null}
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div>
          <p style={{ margin: 0, fontSize: 10, color: "#9aa0a8" }}>{labels.currentPrice}</p>
          <p
            dir="ltr"
            data-testid="recommendation-card-mark"
            style={{
              margin: "2px 0 0",
              fontFamily: MONO,
              fontSize: 22,
              fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
              color: "#f8f5ef",
            }}
          >
            {model.markPrice != null ? formatCardPrice(model.markPrice) : "—"}
          </p>
        </div>
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: `${sideColor}22`,
            color: sideColor,
            flexShrink: 0,
          }}
        >
          <SideArrow sell={model.direction === "sell"} color={sideColor} size={18} />
        </span>
      </div>

      <div
        style={{
          marginTop: 10,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px 12px",
          flexShrink: 0,
        }}
      >
        <Level
          testId="recommendation-card-entry"
          label={labels.entry}
          value={formatCardPrice(model.entry)}
          color="#f8f5ef"
        />
        <Level
          testId="recommendation-card-stop"
          label={labels.stop}
          value={formatCardPrice(model.stopLoss)}
          color={REC_CARD_LOSS_COLOR}
          reached={model.stopHit ? labels.reached : null}
        />
        {model.targets.map((target) => (
          <Level
            key={target.index}
            testId={`recommendation-card-tp${target.index}`}
            label={targetLabels[target.index - 1] ?? ""}
            value={formatCardPrice(target.price)}
            color={REC_CARD_GAIN_COLOR}
            reached={target.hit ? labels.reached : null}
          />
        ))}
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 11, color: "#c5c9d0" }}>{labels.footer}</p>
          <p
            style={{
              margin: "3px 0 0",
              fontFamily: MONO,
              fontSize: 10,
              color: "#8a9098",
            }}
          >
            {formatRecCardDate(model.dateMs, model.locale)}
          </p>
        </div>
        <p
          dir="ltr"
          data-testid="recommendation-card-r"
          style={{
            margin: 0,
            flexShrink: 0,
            fontFamily: MONO,
            fontSize: 22,
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            color: rColor,
          }}
        >
          {formatSignedR(model.rMultiple) ?? "—"}
        </p>
      </div>

      {labels.tip ? (
        <p
          data-testid="recommendation-card-tip"
          style={{
            margin: "10px 0 0",
            fontSize: 11,
            lineHeight: 1.35,
            color: "#d8dbe0",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {labels.tip}
        </p>
      ) : null}

      <div
        style={{
          marginTop: "auto",
          paddingTop: 8,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flexShrink: 0,
        }}
      >
        {model.entryZone ? (
          <p
            data-testid="recommendation-card-zone"
            style={{ margin: 0, fontSize: 10, color: "#8a9098" }}
          >
            {labels.entryZone}{" "}
            <span dir="ltr" style={{ fontFamily: MONO, fontWeight: 700, color: "#d8dbe0" }}>
              {formatCardPrice(model.entryZone.low)} – {formatCardPrice(model.entryZone.high)}
            </span>
          </p>
        ) : null}
        {labels.validity ? (
          <p
            data-testid="recommendation-card-validity"
            style={{ margin: 0, fontSize: 10, color: "#8a9098" }}
          >
            {labels.validity}
            {labels.revision ? ` · ${labels.revision}` : ""}
          </p>
        ) : labels.revision ? (
          <p style={{ margin: 0, fontSize: 10, color: "#8a9098" }}>{labels.revision}</p>
        ) : null}
        <p
          dir="ltr"
          style={{
            margin: "2px 0 0",
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.02em",
            color: "#6e747c",
          }}
        >
          {labels.domain}
        </p>
      </div>
    </article>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.06)",
        color: "#c5c9d0",
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Level({
  label,
  value,
  color,
  reached,
  testId,
}: {
  label: string;
  value: string;
  color: string;
  reached?: string | null;
  testId: string;
}) {
  return (
    <div data-testid={testId} style={{ minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 10, color: "#9aa0a8" }}>{label}</p>
      <p
        dir="ltr"
        style={{
          margin: "2px 0 0",
          fontFamily: MONO,
          fontSize: 15,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color,
        }}
      >
        {value}
      </p>
      {reached ? (
        <span
          style={{
            marginTop: 4,
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            borderRadius: 999,
            background: `${REC_CARD_GAIN_COLOR}22`,
            color: REC_CARD_GAIN_COLOR,
            fontSize: 9,
            fontWeight: 700,
            padding: "2px 6px",
          }}
        >
          <CheckMini />
          {reached}
        </span>
      ) : null}
    </div>
  );
}

function SideArrow({ sell, color, size = 14 }: { sell: boolean; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      {sell ? (
        <path d="M4 5 L8 11 L12 5" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      ) : (
        <path d="M4 11 L8 5 L12 11" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function CheckMini() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M2 5.2 L4.1 7.2 L8.2 2.8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export const REC_CARD_SIZE = { width: W, height: H };
