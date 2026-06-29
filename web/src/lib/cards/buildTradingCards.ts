import type { Recommendation } from "@/lib/types";
import type { ProcessedIntent } from "@/lib/tradeFlow";
import type { ChartDrawing } from "@/lib/chartDrawings";
import type { ChartOverlay } from "@/lib/chartOverlays";
import type { LiveReasoningEntry } from "@/lib/analysis/chartAnalyzeLlm";
import type { TradingCardPayload } from "@/lib/cards/cardTypes";
import { CARD_ACTIONS } from "@/lib/cards/cardActions";
import { selectTradingCards } from "@/lib/cards/cardPolicy";
import { computeRewardRisk } from "@/lib/rewardRisk";

export interface TradingCardSource {
  symbol?: string;
  timeframe?: string;
  market?: string;
  summary?: string;
  recommendations?: Array<Partial<Recommendation>>;
  intents?: ProcessedIntent[];
  drawings?: ChartDrawing[];
  overlays?: ChartOverlay[];
  liveReasoningLog?: LiveReasoningEntry[];
  mt5ConnectionStatus?: "online" | "offline" | "unknown";
}

function firstActionable(recommendations?: Array<Partial<Recommendation>>) {
  return recommendations?.find((r) => r.action === "buy" || r.action === "sell") ?? null;
}

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildTradingCards(source: TradingCardSource): TradingCardPayload[] {
  const cards: TradingCardPayload[] = [];
  const rec = firstActionable(source.recommendations);
  const waitRec = source.recommendations?.find((r) => r.action === "wait");
  const symbol = String(rec?.symbol ?? waitRec?.symbol ?? source.symbol ?? "").toUpperCase();
  const timeframe = String(rec?.timeframe ?? waitRec?.timeframe ?? source.timeframe ?? "1h");
  const entry = numberOrNull(rec?.entry);
  const stopLoss = numberOrNull(rec?.stop_loss);
  const takeProfit = numberOrNull(rec?.take_profit);
  const rr = entry && stopLoss && takeProfit ? computeRewardRisk(entry, stopLoss, takeProfit) : null;

  if (symbol) {
    cards.push({
      id: `analysis-${symbol}-${timeframe}`,
      kind: "analysis",
      title: "بطاقة التحليل",
      symbol,
      timeframe,
      pattern: String(rec?.pattern_name ?? waitRec?.pattern_name ?? "") || null,
      summary: source.summary || String(rec?.rationale ?? waitRec?.rationale ?? "ملخص التحليل الفني."),
      actions: [{ action: CARD_ACTIONS.openChart, label: "فتح الشارت", variant: "secondary", payload: { symbol, timeframe } }],
    });
  }

  if (source.liveReasoningLog?.length) {
    cards.push({
      id: `live-${symbol}-${timeframe}`,
      kind: "live_reasoning",
      title: "سجل التحليل الحي",
      entries: source.liveReasoningLog,
    });
  }

  const patternDrawingIndex = source.drawings?.findIndex((d) => d.patternType || d.semanticRole === "pattern");
  const patternDrawing = patternDrawingIndex != null && patternDrawingIndex >= 0 ? source.drawings?.[patternDrawingIndex] : undefined;
  if (patternDrawing?.patternType || rec?.pattern_name) {
    cards.push({
      id: `pattern-${symbol}-${timeframe}`,
      kind: "pattern",
      title: "النموذج الفني",
      pattern: String(rec?.pattern_name ?? patternDrawing?.label ?? patternDrawing?.patternType ?? "نموذج فني"),
      confidence: patternDrawing?.confidence ?? rec?.confidence,
      drawingIndex: patternDrawingIndex,
      points: patternDrawing?.points,
      actions: patternDrawingIndex != null && patternDrawingIndex >= 0
        ? [{ action: CARD_ACTIONS.showDrawing, label: "إظهار على الشارت", variant: "secondary", payload: { drawingIndex: patternDrawingIndex } }]
        : undefined,
    });
  }

  if (rec && entry && stopLoss && takeProfit) {
    cards.push({
      id: `trade-${symbol}-${timeframe}`,
      kind: "trade_plan",
      title: "خطة الصفقة",
      symbol,
      timeframe,
      side: rec.action as "buy" | "sell",
      entry,
      stopLoss,
      takeProfits: [takeProfit],
      riskReward: rr,
      actions: [
        { action: CARD_ACTIONS.drawTradePlan, label: "رسم على الشارت", variant: "secondary", payload: { symbol, timeframe } },
        { action: CARD_ACTIONS.sendTradePlanToMt5, label: "إرسال إلى MT5", payload: { symbol, timeframe } },
        { action: CARD_ACTIONS.editTradePlan, label: "تعديل الخطة", variant: "ghost", payload: { symbol, timeframe } },
      ],
    });
    cards.push({
      id: `rr-${symbol}-${timeframe}`,
      kind: "risk_reward",
      title: "العائد والمخاطرة",
      riskReward: rr,
      acceptable: rr == null || rr >= 1,
      riskText: rr == null ? "الخطة تحتاج حساب عائد/مخاطرة كامل." : rr >= 1 ? "العائد المتوقع أكبر من المخاطرة." : "العائد أقل من المخاطرة؛ نراجع الخطة قبل التنفيذ.",
    });
  }

  const pendingIntent = source.intents?.find((i) => i.status === "pending");
  if (pendingIntent && stopLoss && (pendingIntent.side === "buy" || pendingIntent.side === "sell")) {
    cards.push({
      id: `ticket-${pendingIntent.id}`,
      kind: "mt5_order_ticket",
      title: "تذكرة أمر MT5",
      symbol: pendingIntent.symbol,
      orderType: pendingIntent.order_type ?? "market",
      side: pendingIntent.side,
      entry: pendingIntent.entry ?? entry,
      stopLoss,
      takeProfit,
      connectionStatus: source.mt5ConnectionStatus ?? "unknown",
      actions: [
        { action: CARD_ACTIONS.confirmOrder, label: "تأكيد التنفيذ", payload: { intentId: pendingIntent.id } },
        { action: CARD_ACTIONS.cancelOrder, label: "إلغاء", variant: "danger", payload: { intentId: pendingIntent.id } },
      ],
    });
  }

  if (source.drawings?.length && symbol) {
    cards.push({
      id: `drawings-${symbol}-${timeframe}`,
      kind: "drawing_summary",
      title: "ملخص الرسومات",
      symbol,
      timeframe,
      drawings: source.drawings,
      canSendToMt5: true,
      actions: [
        { action: CARD_ACTIONS.sendDrawingToMt5, label: "تطبيق على MT5", payload: { symbol, timeframe } },
        { action: CARD_ACTIONS.clearDrawings, label: "مسح", variant: "danger", payload: { symbol, timeframe } },
      ],
    });
  }

  return selectTradingCards(cards);
}
