import { getForexLiveMid } from "./markets/forexPrice";
import {
  drawingPriceBounds,
  parseChartDrawingsJson,
  type ChartDrawing,
} from "./chartDrawings";
import { profileForInterval } from "./analysisProfile";

export type OpportunityVerdict =
  | "valid"
  | "late_entry"
  | "stopped_out"
  | "target_hit"
  | "invalidated"
  | "expired";

export interface OpportunityCheck {
  verdict: OpportunityVerdict;
  livePrice: number;
  messageAr: string;
  canExecute: boolean;
}

interface CheckInput {
  symbol: string;
  side: "buy" | "sell";
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  timeframe?: string | null;
  created_at: string;
  chart_drawings_json?: string | null;
  drawings?: ChartDrawing[];
}

function intentAgeMinutes(createdAt: string): number {
  const t = new Date(createdAt.includes("T") ? createdAt : `${createdAt}Z`);
  return (Date.now() - t.getTime()) / 60000;
}

export async function validateOpportunity(
  input: CheckInput,
  userId?: number,
): Promise<OpportunityCheck> {
  const livePrice =
    userId != null ? await getForexLiveMid(userId, input.symbol) : 0;
  if (livePrice <= 0) {
    return {
      verdict: "valid",
      livePrice: 0,
      messageAr: "تعذّر جلب السعر الحي — سيتم المحاولة عند التنفيذ.",
      canExecute: true,
    };
  }

  const tf = input.timeframe ?? "1h";
  const profile = profileForInterval(tf);
  const ageMin = intentAgeMinutes(input.created_at);

  if (ageMin > profile.intentTtlMinutes) {
    return {
      verdict: "expired",
      livePrice,
      messageAr: `انتهت صلاحية التوصية (أكثر من ${profile.intentTtlMinutes} دقيقة على إطار ${tf}).`,
      canExecute: false,
    };
  }

  const slip = profile.entrySlippagePct / 100;
  const { entry, stop_loss, take_profit, side } = input;

  if (entry != null && entry > 0) {
    if (side === "buy" && livePrice > entry * (1 + slip)) {
      return {
        verdict: "late_entry",
        livePrice,
        messageAr: `تأخرت بالرد: السعر ${livePrice.toFixed(2)} تجاوز منطقة الدخول ${entry.toFixed(2)}.`,
        canExecute: false,
      };
    }
    if (side === "sell" && livePrice < entry * (1 - slip)) {
      return {
        verdict: "late_entry",
        livePrice,
        messageAr: `تأخرت بالرد: السعر ${livePrice.toFixed(2)} تجاوز منطقة الدخول ${entry.toFixed(2)}.`,
        canExecute: false,
      };
    }
  }

  if (stop_loss != null && stop_loss > 0) {
    if (side === "buy" && livePrice <= stop_loss) {
      return {
        verdict: "stopped_out",
        livePrice,
        messageAr: `السعر ${livePrice.toFixed(2)} لمس وقف الخسارة ${stop_loss.toFixed(2)} — ذهبت الفرصة.`,
        canExecute: false,
      };
    }
    if (side === "sell" && livePrice >= stop_loss) {
      return {
        verdict: "stopped_out",
        livePrice,
        messageAr: `السعر ${livePrice.toFixed(2)} لمس وقف الخسارة ${stop_loss.toFixed(2)} — ذهبت الفرصة.`,
        canExecute: false,
      };
    }
  }

  if (take_profit != null && take_profit > 0) {
    if (side === "buy" && livePrice >= take_profit) {
      return {
        verdict: "target_hit",
        livePrice,
        messageAr: `السعر ${livePrice.toFixed(2)} وصل الهدف ${take_profit.toFixed(2)} — فاتك التنفيذ.`,
        canExecute: false,
      };
    }
    if (side === "sell" && livePrice <= take_profit) {
      return {
        verdict: "target_hit",
        livePrice,
        messageAr: `السعر ${livePrice.toFixed(2)} وصل الهدف ${take_profit.toFixed(2)} — فاتك التنفيذ.`,
        canExecute: false,
      };
    }
  }

  const drawings =
    input.drawings ??
    parseChartDrawingsJson(input.chart_drawings_json ?? null);
  const bounds = drawingPriceBounds(
    drawings.filter((d) => d.type === "forecast_path" || d.type === "channel"),
  );
  if (bounds) {
    const pad = (bounds.max - bounds.min) * 0.05;
    const min = bounds.min - pad;
    const max = bounds.max + pad;
    if (livePrice < min || livePrice > max) {
      return {
        verdict: "invalidated",
        livePrice,
        messageAr: `السعر ${livePrice.toFixed(2)} خرج من نطاق السيناريو التنبؤي (${min.toFixed(0)}–${max.toFixed(0)}).`,
        canExecute: false,
      };
    }
  }

  return {
    verdict: "valid",
    livePrice,
    messageAr: "الفرصة ما زالت ضمن حدود التحليل.",
    canExecute: true,
  };
}
